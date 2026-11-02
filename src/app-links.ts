/** Links identify a destination; authentication and object authorization still apply. */
export function appLink(origin:string,kind:'form'|'invite',value:string){
 const url=new URL(origin);url.hash=new URLSearchParams({[kind]:value}).toString();return url.href;
}
