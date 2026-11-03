import "dotenv/config";
/** Installation identity is private configuration, never a public source constant. */
const configuredId = (process.env.DEVELOPER_TELEGRAM_ID ?? '').trim();
if (configuredId && (!/^[1-9]\d*$/.test(configuredId) || !Number.isSafeInteger(Number(configuredId)))) {
 throw new Error('DEVELOPER_TELEGRAM_ID debe ser un identificador positivo válido.');
}
export const DEVELOPER_ID = configuredId ? Number(configuredId) : 0;
export function assertDeveloper(userId:number|null|undefined):void{
 if(DEVELOPER_ID<=0||userId!==DEVELOPER_ID)throw Object.assign(new Error('No tienes permisos para realizar esta operación.'),{statusCode:403});
}

export function globalRole(userId: number, owners: ReadonlySet<number>): "developer" | "owner" | null {
  if (DEVELOPER_ID > 0 && userId === DEVELOPER_ID) return "developer";
  return owners.has(userId) ? "owner" : null;
}

export function globalRoleLabel(role: ReturnType<typeof globalRole>): string | null {
  return role === "developer" ? "Desarrollador" : role === "owner" ? "Administrador total" : null;
}
