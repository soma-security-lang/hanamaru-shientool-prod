/** Metadata only: never persist request bodies, prices, reasons, query or tokens. */
export interface EbayPendingOperation {key:string;searchId:string;action:string;startedAt:number}
const prefix="hanamaru.ebay.pending:";
const keyPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const idPattern=/^[a-z0-9_-]{1,100}$/iu;
const actionPattern=/^(?:create|confirm|cancel|retry|resume|repeat|next-page|outlier-policy|candidates\/[a-z0-9_-]{1,100})$/iu;
export function loadEbayPending(searchId:string):EbayPendingOperation|null{
    const raw=window.sessionStorage.getItem(prefix+searchId);if(!raw)return null;
    const value=JSON.parse(raw) as Partial<EbayPendingOperation>;
    if(Object.keys(value).some(key=>!["key","searchId","action","startedAt"].includes(key))
      ||value.searchId!==searchId||!idPattern.test(searchId)||typeof value.key!=="string"||!keyPattern.test(value.key)
      ||typeof value.action!=="string"||!actionPattern.test(value.action)||!Number.isSafeInteger(value.startedAt)
      ||Number(value.startedAt)<0||Number(value.startedAt)>Date.now())throw new Error("INVALID_PENDING_METADATA");
    return value as EbayPendingOperation;
}
export function saveEbayPending(value:EbayPendingOperation):boolean{
  try{window.sessionStorage.setItem(prefix+value.searchId,JSON.stringify({key:value.key,searchId:value.searchId,action:value.action,startedAt:value.startedAt}));return true;}catch{return false;}
}
export function clearEbayPending(searchId:string):void{
  try{window.sessionStorage.removeItem(prefix+searchId);}catch{/* Saving is refused when metadata storage is unavailable. */}
}
