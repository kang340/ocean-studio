// Minimal JSON client for the Ocean Studio API (same origin, read-only).
export async function api(path:string,body?:unknown,method?:string){
 const response=await fetch('/api'+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const raw=await response.text();let data:any;try{data=JSON.parse(raw)}catch{throw new Error('无法连接 Ocean Studio 服务，请确认 server/app.py 已启动。')} if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail||data));return data;
}
export const bytes=(n:number|null|undefined)=>{if(n==null)return '—';if(n<1024)return n+' B';const i=Math.min(3,Math.floor(Math.log(n)/Math.log(1024)));return (n/1024**i).toFixed(1)+' '+['B','KB','MB','GB'][i]};
