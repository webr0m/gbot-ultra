import type { Api } from 'grammy';
import { z } from 'zod';

const photoUrl = z.string().max(500).url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Usa enlaces HTTPS directos a las fotos.');

export const articleExtrasSchema = z.object({
  heading: z.string().trim().max(120).default(''),
  table: z.array(z.array(z.string().trim().max(120)).min(2).max(6)).max(10).default([]),
  gallery: z.array(photoUrl).max(6).default([]),
}).refine(value => value.table.every(row => row.length === value.table[0]?.length),
  'Todas las filas de la tabla deben tener el mismo número de columnas.');

export const articleSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  extras: articleExtrasSchema,
});
export type ArticleExtras = z.infer<typeof articleExtrasSchema>;
export type RichArticle = z.infer<typeof articleSchema>;
type RichMessage = Parameters<Api['sendRichMessage']>[1];

export function articleMessage(content: string, extras: ArticleExtras): RichMessage {
  const blocks: NonNullable<RichMessage['blocks']> = [];
  if (extras.heading) blocks.push({ type: 'heading', size: 2, text: extras.heading });
  for (const paragraph of content.split(/\r?\n[ \t]*\r?\n+/)) {
    blocks.push({ type: 'paragraph', text: paragraph });
  }
  if (extras.table.length) blocks.push({
    type: 'table',
    is_bordered: true,
    cells: extras.table.map((row, index) => row.map(text => ({
      text, align: 'left', valign: 'top', ...(index === 0 ? { is_header: true } : {}),
    }))),
  });
  if (extras.gallery.length) blocks.push({
    type: 'collage',
    blocks: extras.gallery.map(url => ({ type: 'photo', photo: { type: 'photo', media: url } })),
  });
  return { blocks };
}
