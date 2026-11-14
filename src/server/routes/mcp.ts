import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Bot } from "grammy";
import { z } from "zod";
import type { AppContext } from "../../bot/context.js";
import { getChat } from "../../db/repositories/chats.js";
import { config } from "../../config.js";
import { hasFeature } from "../../services/entitlements.js";
import { ModerationError } from "../../services/moderation.js";
import {
  API_RATE_LIMIT,
  checkKeyRate,
  hasScope,
  recordApiUse,
  verifyApiKey,
  type ApiKeyRow,
} from "../../services/api-access.js";
import {
  applyApiModeration,
  apiModerationContext,
  ApiTargetNotFoundError,
  MODERATION_ACTIONS,
  readApiMembers,
  readApiModerationLog,
  readApiSettings,
  readApiStats,
  resolveApiTarget,
  type ModerationAction,
} from "../api-actions.js";
import { parseIntParam } from "../helpers.js";

/**
 * Protocol revisions the endpoint speaks. The modern revision carries the
 * version on every request; the older ones use the initialize handshake.
 */
export const MCP_VERSIONS = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-03-26";
const META_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";

const ERROR_PARSE = -32700;
const ERROR_INVALID_REQUEST = -32600;
const ERROR_METHOD_NOT_FOUND = -32601;
const ERROR_INVALID_PARAMS = -32602;
const ERROR_INTERNAL = -32603;
const ERROR_UNAUTHORIZED = -32001;
const ERROR_HEADER_MISMATCH = -32020;
const ERROR_UNSUPPORTED_VERSION = -32022;

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: "read" | "moderate";
}

const TOOLS: ToolDefinition[] = [
  {
    name: "list_members",
    title: "Listar miembros",
    description:
      "Lista los miembros registrados del grupo con su estado, mensajes enviados y advertencias.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Cuántos miembros devolver. Por defecto 50.",
        },
        search: {
          type: "string",
          maxLength: 64,
          description: "Filtra por nombre o usuario.",
        },
      },
      additionalProperties: false,
    },
    scope: "read",
  },
  {
    name: "get_stats",
    title: "Estadísticas del grupo",
    description:
      "Devuelve los totales de mensajes, entradas y salidas, y la actividad por día.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          description: "Días a resumir. Por defecto 7.",
        },
      },
      additionalProperties: false,
    },
    scope: "read",
  },
  {
    name: "get_settings",
    title: "Ajustes del grupo",
    description:
      "Devuelve los ajustes vigentes del grupo: filtros, avisos, horarios y niveles de acceso.",
    inputSchema: { type: "object", additionalProperties: false },
    scope: "read",
  },
  {
    name: "list_moderation_log",
    title: "Historial de moderación",
    description:
      "Consulta las últimas acciones de moderación del grupo con su motivo y responsable.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Cuántas acciones devolver. Por defecto 30.",
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Desde dónde empezar.",
        },
        action: {
          type: "string",
          maxLength: 40,
          description: "Filtra por tipo de acción.",
        },
      },
      additionalProperties: false,
    },
    scope: "read",
  },
  {
    name: "moderate_user",
    title: "Moderar a un usuario",
    description:
      "Aplica un bloqueo, desbloqueo, silencio, levantamiento del silencio, expulsión o advertencia a un miembro del grupo.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...MODERATION_ACTIONS],
          description: "Acción de moderación que se va a aplicar.",
        },
        userId: {
          type: "integer",
          description: "Identificador numérico de Telegram del miembro.",
        },
        reason: {
          type: "string",
          maxLength: 500,
          description: "Motivo visible en el grupo.",
        },
        durationSeconds: {
          type: "integer",
          minimum: 0,
          maximum: 2592000,
          description: "Duración del bloqueo o del silencio, en segundos.",
        },
      },
      required: ["action", "userId"],
      additionalProperties: false,
    },
    scope: "moderate",
  },
];

const moderateSchema = z.object({
  action: z.enum(MODERATION_ACTIONS),
  userId: z.number().int().safe().positive(),
  reason: z.string().trim().max(500).optional(),
  durationSeconds: z.number().int().min(0).max(2_592_000).optional(),
});

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== "string") return "";
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1]!.trim() : "";
}

function headerValue(request: FastifyRequest, name: string): string {
  const raw = request.headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
}

function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function resultResponse(
  id: string | number,
  result: Record<string, unknown>,
  modern: boolean,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    result: modern ? { resultType: "complete", ...result } : result,
  };
}

function toolContent(data: unknown, isError = false): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

/**
 * The endpoint is reachable from browsers, so the origin has to belong to the
 * same host. MCP clients installed on a desktop send no origin at all.
 */
function originAllowed(request: FastifyRequest): boolean {
  const origin = headerValue(request, "origin");
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  const requestHost = request.hostname.toLowerCase();
  if (host === requestHost) return true;
  return host === "localhost" || host === "127.0.0.1";
}

export function registerMcpRoutes(
  app: FastifyInstance,
  bot: Bot<AppContext>,
): void {
  async function authenticate(request: FastifyRequest) {
    const token = bearerToken(request);
    if (!token) throw new Error("Falta la cabecera Authorization: Bearer <clave>.");
    const key = await verifyApiKey(token);
    if (!key) throw new Error("La clave no es válida o está anulada.");
    const limit = checkKeyRate(key.id);
    if (!limit.allowed) throw new Error("Demasiadas peticiones. Espera un minuto.");
    const chat = await getChat(key.chat_id);
    if (!chat || !chat.active) throw new Error("El grupo ya no está disponible.");
    if (!hasFeature(chat, "apiAccess", key.created_by))
      throw new Error("Esta función requiere Ultra.");
    await recordApiUse(key.id);
    return { key, chat };
  }

  async function runTool(
    key: ApiKeyRow,
    chat: Awaited<ReturnType<typeof getChat>>,
    tool: ToolDefinition,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (tool.name) {
      case "list_members": {
        const limit = parseIntParam(args.limit, 50, 1, 200);
        const search =
          typeof args.search === "string" ? args.search.trim().slice(0, 64) : "";
        return readApiMembers(chat!, limit, search);
      }
      case "get_stats": {
        const days = parseIntParam(args.days, 7, 1, 90);
        return readApiStats(chat!, days);
      }
      case "get_settings":
        return readApiSettings(chat!);
      case "list_moderation_log": {
        const limit = parseIntParam(args.limit, 30, 1, 100);
        const offset = parseIntParam(args.offset, 0, 0, 20_000);
        const action =
          typeof args.action === "string" ? args.action.trim().slice(0, 40) : "";
        return readApiModerationLog(chat!, limit, offset, action);
      }
      case "moderate_user": {
        const parsed = moderateSchema.safeParse(args);
        if (!parsed.success)
          return {
            ok: false,
            error: "Datos de moderación no válidos.",
            issues: parsed.error.issues.map((issue) => issue.message),
          };
        const body = parsed.data;
        let target;
        try {
          target = await resolveApiTarget(bot.api, chat!.chat_id, body.userId);
        } catch (error) {
          if (error instanceof ApiTargetNotFoundError)
            return { ok: false, error: error.message };
          throw error;
        }
        const context = apiModerationContext(
          bot.api,
          chat!,
          bot.botInfo.id,
          key,
          "MCP",
        );
        try {
          return await applyApiModeration(
            context,
            body.action as ModerationAction,
            target,
            body.reason ?? null,
            body.durationSeconds ?? null,
            key,
            "mcp",
            "Regla del agente MCP",
          );
        } catch (error) {
          if (error instanceof ModerationError)
            return { ok: false, error: error.userMessage };
          throw error;
        }
      }
      default:
        return { ok: false, error: "Herramienta desconocida." };
    }
  }

  app.post("/mcp", async (request, reply) => {
    if (!originAllowed(request)) {
      return reply
        .code(403)
        .type("application/json")
        .send(errorResponse(null, ERROR_INVALID_REQUEST, "Origen no permitido."));
    }
    const body = request.body as JsonRpcRequest | undefined;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply
        .code(400)
        .type("application/json")
        .send(errorResponse(null, ERROR_INVALID_REQUEST, "Mensaje no válido."));
    }
    const id = typeof body.id === "string" || typeof body.id === "number" ? body.id : null;
    const method = typeof body.method === "string" ? body.method : "";
    const params = (body.params ?? {}) as Record<string, unknown>;
    const isNotification = body.id === undefined || body.id === null;

    const headerVersion = headerValue(request, "mcp-protocol-version");
    const meta = (params._meta ?? {}) as Record<string, unknown>;
    const metaVersion =
      typeof meta[META_VERSION_KEY] === "string" ? (meta[META_VERSION_KEY] as string) : "";
    if (headerVersion && metaVersion && headerVersion !== metaVersion) {
      return reply
        .code(400)
        .type("application/json")
        .send(
          errorResponse(
            id,
            ERROR_HEADER_MISMATCH,
            `La cabecera MCP-Protocol-Version (${headerVersion}) no coincide con la versión del cuerpo (${metaVersion}).`,
          ),
        );
    }
    const requested = headerVersion || metaVersion || LEGACY_VERSION;
    if (!MCP_VERSIONS.includes(requested as (typeof MCP_VERSIONS)[number])) {
      return reply
        .code(400)
        .type("application/json")
        .send(
          errorResponse(
            id,
            ERROR_UNSUPPORTED_VERSION,
            "Versión de protocolo no admitida.",
            { supported: [...MCP_VERSIONS], requested },
          ),
        );
    }
    const modern = requested === MODERN_VERSION;

    if (isNotification) {
      // Notifications carry no id, so the transport answers with 202 and no body.
      return reply.code(202).send();
    }
    const requestId = id as string | number;

    if (!method) {
      return reply
        .code(400)
        .type("application/json")
        .send(errorResponse(id, ERROR_INVALID_REQUEST, "Falta el método."));
    }

    let key: ApiKeyRow;
    let chat: Awaited<ReturnType<typeof getChat>>;
    try {
      const auth = await authenticate(request);
      key = auth.key;
      chat = auth.chat;
    } catch (error) {
      reply.header("WWW-Authenticate", 'Bearer realm="GBot Ultra"');
      return reply
        .code(401)
        .type("application/json")
        .send(
          errorResponse(
            id,
            ERROR_UNAUTHORIZED,
            error instanceof Error ? error.message : "No autorizado.",
          ),
        );
    }

    try {
      switch (method) {
        case "initialize": {
          const legacy = requested !== MODERN_VERSION;
          return reply
            .type("application/json")
            .send(
              resultResponse(
                requestId,
                {
                  protocolVersion: legacy ? requested : MODERN_VERSION,
                  capabilities: { tools: { listChanged: false } },
                  serverInfo: { name: "GBot Ultra", version: config.version },
                },
                modern,
              ),
            );
        }
        case "server/discover": {
          return reply
            .type("application/json")
            .send(
              resultResponse(
                requestId,
                {
                  supportedVersions: [...MCP_VERSIONS],
                  capabilities: { tools: { listChanged: false } },
                  _meta: {
                    "io.modelcontextprotocol/serverInfo": {
                      name: "GBot Ultra",
                      version: config.version,
                    },
                  },
                  instructions:
                    "Herramientas de un grupo de Telegram de GBot Ultra: consulta miembros, estadísticas, ajustes e historial, y aplica sanciones con el mismo control de permisos del panel.",
                },
                modern,
              ),
            );
        }
        case "ping":
          return reply.type("application/json").send(resultResponse(requestId, {}, modern));
        case "tools/list": {
          const tools = TOOLS.filter((tool) =>
            tool.scope === "read" ? hasScope(key, "read") : hasScope(key, "moderate"),
          ).map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
          }));
          return reply
            .type("application/json")
            .send(resultResponse(requestId, { tools }, modern));
        }
        case "tools/call": {
          const name = typeof params.name === "string" ? params.name : "";
          const tool = TOOLS.find((entry) => entry.name === name);
          if (!tool)
            return reply
              .code(404)
              .type("application/json")
              .send(
                errorResponse(id, ERROR_METHOD_NOT_FOUND, `Herramienta desconocida: ${name}.`),
              );
          if (tool.scope === "moderate" && !hasScope(key, "moderate"))
            return reply
              .code(403)
              .type("application/json")
              .send(
                errorResponse(
                  id,
                  ERROR_INVALID_PARAMS,
                  "La clave no tiene el ámbito moderate.",
                ),
              );
          const args =
            params.arguments && typeof params.arguments === "object"
              ? (params.arguments as Record<string, unknown>)
              : {};
          try {
            const data = await runTool(key, chat, tool, args);
            const failed =
              typeof data === "object" &&
              data !== null &&
              (data as { ok?: unknown }).ok === false;
            return reply
              .type("application/json")
              .send(resultResponse(requestId, toolContent(data, failed), modern));
          } catch (error) {
            return reply
              .type("application/json")
              .send(
                resultResponse(
                  requestId,
                  toolContent(
                    {
                      ok: false,
                      error:
                        error instanceof Error
                          ? error.message
                          : "No se pudo completar la herramienta.",
                    },
                    true,
                  ),
                  modern,
                ),
              );
          }
        }
        default:
          return reply
            .code(404)
            .type("application/json")
            .send(errorResponse(id, ERROR_METHOD_NOT_FOUND, `Método no encontrado: ${method}.`));
      }
    } catch (error) {
      return reply
        .code(500)
        .type("application/json")
        .send(
          errorResponse(
            id,
            ERROR_INTERNAL,
            error instanceof Error ? error.message : "Error interno.",
          ),
        );
    }
  });

  app.get("/mcp", async (_request, reply) =>
    reply
      .code(405)
      .type("application/json")
      .send(
        errorResponse(
          null,
          ERROR_INVALID_REQUEST,
          "El punto MCP solo admite POST.",
        ),
      ),
  );

  app.get("/api/v1/mcp", async () => ({
    ok: true,
    service: "GBot Ultra MCP",
    endpoint: "/mcp",
    transport: "Streamable HTTP",
    protocolVersions: [...MCP_VERSIONS],
    authentication: "Authorization: Bearer <clave>",
    rateLimit: { requestsPerMinute: API_RATE_LIMIT },
    scopes: ["read", "moderate"],
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      scope: tool.scope,
      description: tool.description,
    })),
  }));
}
