export type ParsedLine={lineNo:number;rawText:string;state:"ignored"|"unresolved";parsedName?:string;qty?:number;setCode?:string;collectorNo?:string;reason?:string};
const headings=/^(deck|mainboard|sideboard|commander|companion|maybeboard):?$/i;
export function parseImport(text:string):ParsedLine[]{
 const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/);
 return lines.map((rawText,i)=>{
  let s=rawText.trim(); const base={lineNo:i+1,rawText};
  if(!s||s.startsWith("#")||s.startsWith("//")||headings.test(s)) return {...base,state:"ignored" as const,reason:"Ignored heading, comment, or blank line"};
  const q=s.match(/^(\d+)(?:[xX])?[ \t]+(.+)$/);
  if(!q&&/^[+-]?(?:\d|\.\d)/.test(s)) return {...base,state:"unresolved" as const,reason:"Quantity must be a whole number between 1 and 9999"};
  const qty=q?Number(q[1]):1; if(q) s=q[2].trim();
  if(!Number.isInteger(qty)||qty<1||qty>9999) return {...base,state:"unresolved" as const,reason:"Quantity must be a whole number between 1 and 9999"};
  let changed=true; while(changed){changed=false;const n=s.replace(/[ \t]+(?:\[[^\[\]]*\]|\*[fFeE]\*)$/u,"").trimEnd();if(n!==s){s=n;changed=true}}
  let setCode:string|undefined,collectorNo:string|undefined;
  const p=s.match(/^(.*?)[ \t]+\(([A-Za-z0-9]{2,16})\)(?:[ \t]+([0-9][A-Za-z0-9*\-]*))?$/u);
  if(p){s=p[1].trim();setCode=p[2].toLowerCase();collectorNo=p[3]}
  if(!s||/^\[[^\]]+\]$/.test(s)) return {...base,state:"unresolved" as const,qty,reason:"Card name is missing"};
  return {...base,state:"unresolved" as const,parsedName:s,qty,setCode,collectorNo};
 });
}
export function mergeResolved(current:Record<string,number>,lines:{scryfallId:string;qty:number}[]){const out={...current};for(const l of lines)out[l.scryfallId]=(out[l.scryfallId]??0)+l.qty;return out}
