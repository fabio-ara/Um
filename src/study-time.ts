/** Observation of foreground activity, never a measure of attention or mastery. */
export type TimeMode='reading'|'practice'|'exploration';
export function foregroundSeconds(previous:number,current:number,visible:boolean,focused:boolean):number{
 const elapsed=current-previous;
 return visible&&focused&&elapsed>0&&elapsed<=2500?elapsed/1000:0;
}
export function remainingMinutes(unitIds:string[],currentUnitId:string,records:{unitId:string;seconds:number;mode?:TimeMode}[]):number|null{
 const prior=unitIds.slice(0,unitIds.indexOf(currentUnitId)),remaining=unitIds.length-unitIds.indexOf(currentUnitId);
 const durations=prior.map(id=>records.filter(r=>r.unitId===id&&(r.mode||'reading')==='reading').reduce((n,r)=>n+r.seconds,0)).filter(n=>n>=15);
 if(!durations.length||remaining<1)return null;
 durations.sort((a,b)=>a-b);return Math.max(1,Math.ceil(durations[Math.floor(durations.length/2)]*remaining/60));
}
