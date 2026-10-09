"use client";
import { useEffect, useState } from "react";
import { ebayMarketPriceResources } from "@/lib/api/ebay-market-price";
import { ebayMarketLabels } from "./EbaySearchControls";
import styles from "./MarketPriceExperience.module.css";

export function EbaySearchHistory({onOpen,onError}:{onOpen:(id:string,view:"progress"|"candidates"|"result")=>void;onError:(message:string)=>void}){
  const [items,setItems]=useState<Awaited<ReturnType<typeof ebayMarketPriceResources.list>>["items"]>();
  useEffect(()=>{
    let active=true;
    void ebayMarketPriceResources.list().then(value=>{if(active)setItems(value.items);}).catch(error=>{if(active)onError(error instanceof Error?error.message:"eBay履歴を取得できませんでした");});
    return()=>{active=false;};
  },[onError]);
  return <section className={styles.panel}><h2>eBay検索履歴</h2><p>保存済み結果の閲覧では外部検索・検索枠消費は発生しません。</p>
    {!items?<p role="status">履歴を読み込んでいます</p>:!items.length?<p>eBayの検索履歴はありません。</p>:items.map(item=><article className={styles.panel} key={item.id}>
      <h3>{item.planJson.keyword}</h3><p>{item.planJson.markets.map(market=>ebayMarketLabels[market]).join("、")}</p>
      <p>{new Date(item.createdAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}・{({confirmed:"確定済み",ready:"取得済み",partial:"一部取得",cancelled:"取消済み",blocked:"安全停止",failed:"失敗"} as Record<string,string>)[item.status]??"処理中"}</p>
      <button type="button" className={styles.secondaryButton} onClick={()=>onOpen(item.id,item.status==="confirmed"?"result":["ready","partial"].includes(item.status)?"candidates":"progress")}>保存した検索を開く</button>
    </article>)}
  </section>;
}
