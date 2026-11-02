import type {Buffer} from 'node:buffer';
import {z} from 'zod';
import type {ExtractionQuality} from './quality.ts';
export const blockSchema=z.strictObject({kind:z.string().min(1).max(60),text:z.string().min(1).max(100000),locator:z.string().max(200).optional(),meta:z.record(z.string(),z.unknown()).default({})});
export type Block=z.infer<typeof blockSchema>;
export interface Extraction {blocks:Block[];warnings:string[];original:Buffer;mime:string;filename:string;quality:ExtractionQuality;metadata:{title:string;author:string;edition:string};canonical_hash:string;}
