/** Native invoked accounting. A reservation is not a measured token count. */
export interface InvokedUsage {provider:'codex';unit:'tokens';amount:number|null;budgetCharge:number;cap:number;overCap:boolean}
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function invokedUsage(usage:readonly {unit:string;amount:number;afterTurn:boolean}[],cap:number):InvokedUsage {
 if(!finite(cap)||cap<=0||cap>100000||usage.length>1||usage.some(u=>u.unit!=='tokens'||!finite(u.amount)||u.afterTurn!==true))throw new Error('Invalid native invoked usage.');
 const amount=usage[0]?.amount??null;
 return {provider:'codex',unit:'tokens',amount,budgetCharge:amount??cap,cap,overCap:amount!==null&&amount>cap};
}
export function validInvokedUsage(v:unknown):v is InvokedUsage {
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const x=v as InvokedUsage;
 return x.provider==='codex'&&x.unit==='tokens'&&finite(x.cap)&&x.cap>0&&x.cap<=100000&&(x.amount===null||finite(x.amount))&&x.budgetCharge===(x.amount??x.cap)&&x.overCap===(x.amount!==null&&x.amount>x.cap);
}
export function invokedUsageLabel(v:InvokedUsage):string {
 return v.amount===null?`Codex: tokens not reported; ${v.cap.toLocaleString()} tokens charged conservatively against this approval.`:
  `Codex: ${v.amount.toLocaleString()} tokens${v.overCap?' — over the approved cap; review again before another request.':''}`;
}
