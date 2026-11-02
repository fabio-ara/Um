import express from 'express';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {toNodeHandler} from '@modelcontextprotocol/node';
import {config} from './config.ts';
import {httpHandler} from './http.ts';
export function createApp(){const app=express();app.disable('x-powered-by');app.use(toNodeHandler({fetch:httpHandler},{maxRequestBodySize:16*1024*1024}));return app;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)createApp().listen(config.port,config.local?'127.0.0.1':'0.0.0.0',()=>console.log(`Um API ${config.apiOrigin}`));
