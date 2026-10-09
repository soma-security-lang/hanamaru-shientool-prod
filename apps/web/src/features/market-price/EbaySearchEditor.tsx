"use client";
import {useState} from "react";
import type {EbaySearchDetailDto,EbaySearchSelection} from "@hanamaru/contracts";
import {EbaySearchControls} from "./EbaySearchControls";
import styles from "./MarketPriceExperience.module.css";

/** Editing creates a new search; the confirmed product identity and old snapshots stay immutable. */
export function EbaySearchEditor({detail,disabled,onSubmit}:{detail:EbaySearchDetailDto;disabled:boolean;onSubmit:(body:Record<string,unknown>)=>void}){
  const [keyword,setKeyword]=useState(detail.plan.keyword);
  const [exclusions,setExclusions]=useState((detail.exclusionKeywords??[]).join("\n"));
  const [outlier,setOutlier]=useState(detail.outlierPercent);
  const [mode,setMode]=useState<"reuse"|"latest">("reuse");
  const [selection,setSelection]=useState<EbaySearchSelection>({markets:[...detail.plan.markets],conditions:[...detail.plan.conditions],buyingFormat:detail.plan.buyingFormat,consumptionConfirmed:false});
  const revoke=()=>setSelection(value=>({...value,consumptionConfirmed:false}));
  const words=exclusions.split(/\r?\n/u).map(value=>value.normalize("NFKC").trim()).filter(Boolean);
  const valid=keyword.normalize("NFKC").trim().length>0&&keyword.normalize("NFKC").trim().length<=200
    &&words.length<=20&&words.every(word=>word.length<=100)&&Number.isInteger(outlier)&&outlier>=1&&outlier<=100;
  return <details className={styles.panel}><summary>条件を編集して再検索</summary>
    <p>以前の確定結果は変更しません。確認済み商品の型番は維持します。別の商品を調べる場合は商品入力から開始してください。条件を変えると最大消費枠の再確認が必要です。</p>
    <fieldset disabled={disabled}>
      <label className={styles.editQuery}>再検索の検索語<input maxLength={200} value={keyword} onChange={event=>{setKeyword(event.target.value);revoke();}}/></label>
      <label className={styles.editQuery}>再検索の除外語（1行1語・最大20語）<textarea value={exclusions} onChange={event=>{setExclusions(event.target.value);revoke();}}/></label>
      <label className={styles.editQuery}>再検索の外れ値基準（%）<input type="number" min={1} max={100} step={1} value={outlier} onChange={event=>{setOutlier(Number(event.target.value));revoke();}}/></label>
      <label className={styles.editQuery}>再検索の取得方法<select value={mode} onChange={event=>{setMode(event.target.value as "reuse"|"latest");revoke();}}><option value="reuse">条件・鮮度が一致する自社保存結果を利用</option><option value="latest">自社保存結果を使わず最新を取得</option></select></label>
      <EbaySearchControls value={selection} onChange={setSelection} acquisitionMode={mode}/>
      {!valid?<p role="status">検索語・除外語・外れ値基準を確認してください。</p>:null}
      <button type="button" className={styles.secondaryButton} disabled={!valid||!selection.consumptionConfirmed||!selection.markets.length||!selection.conditions.length} onClick={()=>onSubmit({expectedLockVersion:detail.lockVersion,mode:"edited",keyword,exclusionKeywords:words,outlierPercent:outlier,acquisitionMode:mode,...selection})}>編集した条件で新しい検索を開始</button>
    </fieldset>
  </details>;
}
