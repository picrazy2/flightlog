// THROWAWAY: re-parse specific message IDs with the (per-person) Gemini parser.
import { refreshGmailAccessToken } from "../_shared/gmail/gmail-client.ts";
import { parseEmailForFlights } from "../_shared/gmail/gemini-parser.ts";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_PDF_BYTES = 5 * 1024 * 1024;
function b64urlToStd(s: string){return s.replace(/-/g,"+").replace(/_/g,"/");}
function decodeText(d: string){try{const b=atob(b64urlToStd(d));return new TextDecoder().decode(Uint8Array.from(b,c=>c.charCodeAt(0)));}catch{return"";}}
function htmlToText(h: string){return h.replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/[ \t]{2,}/g," ").replace(/\n{3,}/g,"\n\n").trim();}
// deno-lint-ignore no-explicit-any
function extractBody(p:any):string{let pl="",ht="";const w=(x:any)=>{if(!x)return;const mt=x.mimeType||"",d=x.body?.data;if(mt==="text/plain"&&d)pl+=decodeText(d)+"\n";else if(mt==="text/html"&&d)ht+=decodeText(d)+"\n";for(const c of x.parts??[])w(c);};w(p);const fh=ht?htmlToText(ht):"";return(pl.trim().length>=fh.length?pl:fh).trim().slice(0,20000);}
Deno.serve(async (req)=>{
  const exp=Deno.env.get("EDGE_FUNCTION_SECRET");
  if(exp&&req.headers.get("x-debug-secret")!==exp)return json({error:"unauthorized"},401);
  const tok=await refreshGmailAccessToken(Deno.env.get("GOOGLE_CLIENT_ID")!,Deno.env.get("GOOGLE_CLIENT_SECRET")!,Deno.env.get("GOOGLE_REFRESH_TOKEN")!);
  const gk=Deno.env.get("GEMINI_API_KEY")!;
  const owner={name:Deno.env.get("GMAIL_OWNER_NAME")??undefined,email:Deno.env.get("GMAIL_OWNER_EMAIL")??undefined};
  const body=await req.json().catch(()=>({})); const ids:string[]=body.message_ids??[]; const out=[];
  for(const id of ids){try{
    const r=await fetch(`${GMAIL_BASE}/messages/${id}?format=full`,{headers:{Authorization:`Bearer ${tok}`}});
    if(!r.ok){out.push({id,error:`gmail ${r.status}`});continue;}
    const m=await r.json();
    const h=Object.fromEntries((m.payload?.headers??[]).map((x:{name:string;value:string})=>[x.name.toLowerCase(),x.value]));
    const att:Array<{filename:string;data:string}>=[];
    // deno-lint-ignore no-explicit-any
    const fp=async(p:any):Promise<void>=>{if(!p||att.length)return;const a=p.body?.attachmentId;if(a&&(String(p.filename).toLowerCase().endsWith(".pdf")||String(p.mimeType).includes("pdf"))){if((p.body?.size??0)<=MAX_PDF_BYTES){const ar=await fetch(`${GMAIL_BASE}/messages/${id}/attachments/${a}`,{headers:{Authorization:`Bearer ${tok}`}});if(ar.ok){const ad=await ar.json();att.push({filename:p.filename,data:b64urlToStd(ad.data??"")});}}}for(const c of p.parts??[])await fp(c);};
    await fp(m.payload);
    const parsed=await parseEmailForFlights(gk,{subject:h.subject??"",from:h.from??"",date:h.date??"",body:extractBody(m.payload),attachments:att},owner.name?owner:undefined);
    out.push({id,parsed});
  }catch(e){out.push({id,error:String(e)});}}
  return json({results:out});
});
function json(o:unknown,s=200){return new Response(JSON.stringify(o),{status:s,headers:{"Content-Type":"application/json"}});}
