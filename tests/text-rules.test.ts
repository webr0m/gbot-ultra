import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js',()=>({config:{ownerIds:new Set([900000001]),captchaTimeoutSeconds:300,logLevel:'silent',databaseUrl:''}}));
vi.mock('../src/db/pool.js',()=>({
 query:vi.fn(async()=>({rows:[],rowCount:0})),
 one:vi.fn(async()=>null),
 many:vi.fn(async()=>[]),
 withTransaction:vi.fn(async()=>{throw new Error('La configuración no debe persistirse en este escenario.');}),
}));

import { ADVANCED_DEFAULTS, effectiveAdvanced, saveAdvanced } from '../src/services/advanced-config.js';
import { matchContent } from '../src/services/advanced-engine.js';
import { clampTextRules, compiledTextRules, evaluateTextRules, parseTextRules, TEXT_RULE_LIMITS, textRuleLimits } from '../src/services/text-rules.js';

const premium=TEXT_RULE_LIMITS.premium,pro=TEXT_RULE_LIMITS.pro,ultra=TEXT_RULE_LIMITS.ultra;
const chat=(tier:'premium'|'pro'|'ultra')=>({chat_id:-1002,premium_until:new Date(Date.now()+86400000),premium_tier:tier,pro_license_id:null,settings:{}}) as never;
const rules=(count:number)=>Array.from({length:count},(_,index)=>'palabra'+index).join('\n');

describe('Escala de reglas por nivel',()=>{
 it('conserva el presupuesto histórico de Premium y amplía Pro y Ultra',()=>{
  expect(premium).toEqual({rules:30,terms:5,chars:2000,exceptions:30});
  expect(pro.rules).toBe(200);
  expect(pro.terms).toBe(10);
  expect(ultra.rules).toBe(500);
  expect(ultra.terms).toBe(15);
  expect(textRuleLimits('ultra')).toEqual(ultra);
  expect(textRuleLimits('free')).toEqual(premium);
 });
 it('informa el exceso de reglas como límite de nivel y no como error de sintaxis',()=>{
  const set=parseTextRules(rules(31),'',premium);
  expect(set.limitErrors.length).toBe(1);
  expect(set.errors.length).toBe(0);
  expect(parseTextRules(rules(200),'',pro).limitErrors).toEqual([]);
  expect(parseTextRules(rules(500),'',ultra).limitErrors).toEqual([]);
  expect(parseTextRules(rules(501),'',ultra).limitErrors.length).toBe(1);
 });
 it('informa el exceso de términos y de caracteres como límite de nivel',()=>{
  expect(parseTextRules('a1 && b2 && c3 && d4 && e5 && f6','',premium).limitErrors.length).toBe(1);
  expect(parseTextRules('palabra'.repeat(400),'',premium).limitErrors.length).toBe(1);
 });
 it('no cuenta los comentarios como reglas',()=>{
  const set=parseTextRules(['# nota del administrador','uno','# otra nota','dos'].join('\n'),'',premium);
  expect(set.rules.map((rule)=>rule.terms[0])).toEqual(['uno','dos']);
 });
});

describe('Sintaxis de las reglas',()=>{
 it('lee una regla por línea con términos unidos por &&',()=>{
  const set=parseTextRules('venta && oferta\notro','',premium);
  expect(set.rules[0]!.terms).toEqual(['venta','oferta']);
  expect(set.rules[1]!.terms).toEqual(['otro']);
 });
 it('acepta la acción y la duración propias de cada regla',()=>{
  const set=parseTextRules('spam :: mute :: 3600\nfraude :: ban','',premium);
  expect(set.rules[0]).toMatchObject({action:'mute',durationSeconds:3600});
  expect(set.rules[1]).toMatchObject({action:'ban',durationSeconds:null});
 });
 it('admite una duración sin acción',()=>{
  const set=parseTextRules('spam :: 600','',premium);
  expect(set.rules[0]).toMatchObject({action:null,durationSeconds:600});
 });
 it('rechaza una acción desconocida, una duración fuera de rango y un término vacío',()=>{
  expect(parseTextRules('spam :: expulsar','',premium).errors.length).toBe(1);
  expect(parseTextRules('spam :: mute :: 10','',premium).errors.length).toBe(1);
  expect(parseTextRules('spam &&','',premium).errors.length).toBe(1);
  expect(parseTextRules('a','',premium).errors.length).toBe(1);
 });
 it('acepta comentarios y líneas vacías sin producir reglas',()=>{
  const set=parseTextRules('# comentario\n\n  \nregla','',premium);
  expect(set.rules.length).toBe(1);
 });
});

describe('Recorte al nivel del grupo',()=>{
 it('conserva el texto original cuando todo cabe en el presupuesto',()=>{
  const text='uno\ndos';
  expect(clampTextRules(text,'',premium).patterns).toBe(text);
 });
 it('elimina las reglas que el nivel ya no cubre',()=>{
  const clamped=clampTextRules(rules(40),'',premium);
  expect(clamped.patterns.split('\n').length).toBe(30);
  expect(clamped.patterns.split('\n')[29]).toBe('palabra29');
 });
 it('recorta los términos que superan el presupuesto del nivel',()=>{
  const clamped=clampTextRules('a1 && b2 && c3 && d4 && e5 && f6','',premium);
  expect(clamped.patterns.split('&&').length).toBe(5);
 });
 it('deja de aplicar las reglas retiradas tras una baja de nivel',()=>{
  const settings=structuredClone(ADVANCED_DEFAULTS);
  settings.textLimits.patterns=rules(40);
  const effective=effectiveAdvanced(chat('premium'),settings);
  expect(effective.textLimits.patterns.split('\n').length).toBe(30);
  expect(settings.textLimits.patterns.split('\n').length).toBe(40);
 });
 it('mantiene las reglas dentro del presupuesto en Pro y Ultra',()=>{
  const settings=structuredClone(ADVANCED_DEFAULTS);
  settings.textLimits.patterns=rules(200);
  expect(effectiveAdvanced(chat('pro'),settings).textLimits.patterns.split('\n').length).toBe(200);
  expect(effectiveAdvanced(chat('ultra'),settings).textLimits.patterns.split('\n').length).toBe(200);
 });
});

describe('Coincidencia de las reglas',()=>{
 it('devuelve la primera regla que coincide',()=>{
  const set=parseTextRules('venta\noferta','',premium);
  const verdict=evaluateTextRules(set,'comprar oferta ahora');
  expect(verdict.matched?.terms).toEqual(['oferta']);
 });
 it('exige todos los términos de la regla',()=>{
  const set=parseTextRules('venta && oferta','',premium);
  expect(evaluateTextRules(set,'venta disponible').matched).toBeNull();
  expect(evaluateTextRules(set,'venta y oferta').matched).not.toBeNull();
 });
 it('acepta comodines y cualquier orden',()=>{
  const set=parseTextRules('vent*oferta','',premium);
  expect(evaluateTextRules(set,'hoy hay una venta con oferta').matched).not.toBeNull();
 });
 it('normaliza mayúsculas y acentos como antes',()=>{
  const set=parseTextRules('Café','',premium);
  expect(evaluateTextRules(set,'un CAFÉ caliente').matched).not.toBeNull();
 });
 it('una excepción conserva el mensaje aunque coincida una regla',()=>{
  const set=parseTextRules('venta','',premium);
  set.exceptions.push(...parseTextRules('!oferta','',premium).exceptions);
  const verdict=evaluateTextRules(set,'oferta de venta');
  expect(verdict.allowed).toBe(true);
  expect(verdict.matched).toBeNull();
 });
 it('conserva el bloque de excepciones separado de las reglas',()=>{
  const set=parseTextRules('venta','excepcion',premium);
  expect(set.rules.length).toBe(1);
  expect(set.exceptions.length).toBe(1);
  expect(set.exceptions[0]!.action).toBeNull();
 });
});

describe('Aplicación en el motor',()=>{
 const settings=(patterns:string,exceptions='')=>{const s=structuredClone(ADVANCED_DEFAULTS);s.textLimits.patterns=patterns;s.textLimits.exceptions=exceptions;return s;};
 it('usa la acción propia de la regla y la duración propia',()=>{
  const matched=matchContent({text:'compra esto ahora'} as never,settings('compra :: mute :: 600'));
  expect(matched?.type).toBe('text_pattern');
  expect(matched?.action).toBe('mute');
  expect(matched?.durationSeconds).toBe(600);
 });
 it('recurre a la acción general cuando la regla no define la suya',()=>{
  const s=settings('compra');s.textLimits.action='ban';s.textLimits.durationSeconds=900;
  const matched=matchContent({text:'compra esto ahora'} as never,s);
  expect(matched?.action).toBe('ban');
  expect(matched?.durationSeconds).toBe(900);
 });
 it('no sanciona cuando una excepción coincide',()=>{
  const s=settings('compra','permiso');
  expect(matchContent({text:'compra con permiso'} as never,s)).toBeNull();
 });
 it('conserva el número de línea de la regla que coincidió',()=>{
  const matched=matchContent({text:'oferta'} as never,settings('# nota\nventa\noferta'));
  expect(matched?.pattern?.line).toBe(3);
 });
 it('reutiliza las reglas compiladas entre mensajes',()=>{
  const first=compiledTextRules('venta','',premium);
  const second=compiledTextRules('venta','',premium);
  expect(first).toBe(second);
 });
});

describe('Guarda con el límite del nivel',()=>{
 it('rechaza más reglas de las que permite el nivel',async()=>{
  const settings=structuredClone(ADVANCED_DEFAULTS);
  settings.textLimits.patterns=rules(31);
  await expect(saveAdvanced(chat('premium'),settings,42,0)).rejects.toMatchObject({statusCode:402});
 });
 it('acepta el presupuesto completo de Pro',async()=>{
  const settings=structuredClone(ADVANCED_DEFAULTS);
  settings.textLimits.patterns=rules(200);
  await expect(saveAdvanced(chat('pro'),settings,42,0)).rejects.not.toMatchObject({statusCode:402});
 });
 it('rechaza una regla mal escrita con un error de sintaxis',async()=>{
  const settings=structuredClone(ADVANCED_DEFAULTS);
  settings.textLimits.patterns='compra :: expulsar';
  await expect(saveAdvanced(chat('ultra'),settings,42,0)).rejects.toMatchObject({statusCode:400});
 });
});
