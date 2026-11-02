import {defineConfig} from 'vite';
export default defineConfig(({command})=>({base:command==='build'?'/Um/':'/',server:{host:'127.0.0.1',port:4419,strictPort:true},build:{target:'es2022',outDir:'dist'},define:{__UM_API__:JSON.stringify(process.env.VITE_API_ORIGIN||'http://127.0.0.1:4417')}}));
