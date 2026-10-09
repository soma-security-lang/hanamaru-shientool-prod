"use client";
import { useEffect, useRef, useState } from "react";
import type { EbaySearchDetailDto, MarketPriceSearchDto } from "@hanamaru/contracts";
import { resources } from "@/lib/api/resources";
import { ebayMarketLabels } from "./EbaySearchControls";
import styles from "./MarketPriceExperience.module.css";
import comparison from "./EbayReferenceComparison.module.css";

/** Explicit read-only comparison. Never buys another search or converts currencies. */
export function EbayReferenceComparison({ detail }: { detail: EbaySearchDetailDto }) {
  const [items, setItems] = useState<MarketPriceSearchDto[]>();
  const [selected, setSelected] = useState<MarketPriceSearchDto>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(()=>()=>{request.current++;},[]);
  async function load() {
    const current = ++request.current;
    setBusy(true); setError("");
    try {
      const response = await resources.marketPriceSearches();
      if (request.current !== current) return;
      setItems(response.items.filter(item => item.status === "confirmed" && Boolean(item.resultId)));
    } catch { if (request.current === current) setError("保存済み結果を取得できませんでした。新規検索は行っていません。"); }
    finally { if (request.current === current) setBusy(false); }
  }
  async function choose(id: string) {
    const current = ++request.current;
    setSelected(undefined); setAcknowledged(false); setError("");
    if (!id) return;
    setBusy(true);
    try {
      const value = await resources.marketPriceSearch(id);
      if (request.current !== current) return;
      if (value.status !== "confirmed" || !value.resultId) throw new Error("NOT_CONFIRMED");
      setSelected(value);
    } catch { if (request.current === current) setError("選択した確定結果を確認できません。別の結果へ自動切替はしていません。"); }
    finally { if (request.current === current) setBusy(false); }
  }
  const snapshot = detail.snapshots[0];
  const differentInput = selected && selected.identificationId !== detail.identificationId;
  return <section className={styles.panel} aria-label="取得元間の参考比較">
    <h3>ヤフオク・オークファンとの参考比較</h3>
    <p>保存済みの確定結果を読み取るだけです。新規の外部検索・検索枠消費はありません。通貨・期間・商品状態が異なるため、混合中央値・価格差率・利益は算出しません。</p>
    <div className={comparison.controls}>
    <button type="button" className={styles.secondaryButton} disabled={busy} onClick={()=>void load()}>比較できる保存結果を読み込む</button>
    {error?<p role="alert">{error}</p>:null}
    {items?<><label className={comparison.field}>国内の確定結果を選択<select disabled={busy || !items.length} defaultValue="" onChange={event=>void choose(event.target.value)}>
      <option value="">選択してください</option>
      {items.map(item=><option key={item.id} value={item.id}>{item.sourceProvider==="aucfan_api"?"オークファン":"ヤフオク"}・{String(item.query.keyword??"検索語未記録")}・{item.confirmedAt?new Date(item.confirmedAt).toLocaleDateString("ja-JP"):"確定日未記録"}</option>)}
    </select></label>{!items.length?<p>閲覧可能な国内の確定結果はありません。</p>:null}</>:null}
    </div>
    {selected?<><dl className={styles.resultMeta}>
      <div><dt>国内検索語</dt><dd>{String(selected.query.keyword??"未記録")}</dd></div>
      <div><dt>eBay検索語</dt><dd>{detail.plan.keyword}</dd></div>
      <div><dt>商品入力の対応</dt><dd>{differentInput?"別の商品入力です。同一商品・型番・構成か確認が必要です。":"同じ商品入力。ただし状態・検索条件の一致は保証しません。"}</dd></div>
      <div><dt>国内の状態指定</dt><dd>{selected.conditions.join("、")||"未記録"}</dd></div>
      <div><dt>eBayの状態指定</dt><dd>{detail.plan.conditions.join("、")||"未指定"}（国内中古の細分区分とは異なります）</dd></div>
      <div><dt>国内の取得範囲</dt><dd>{selected.periodStart}〜{selected.periodEnd}・{selected.coverageStatus==="complete"?"90日取得完了":"一部取得・参考値"}</dd></div>
      <div><dt>eBayの取得範囲</dt><dd>市場別の要求ページ内・日付は年推定を含む。90日全件取得ではありません。確定日時：{snapshot?.confirmedAt??"未確定"}</dd></div>
    </dl>
    <label className={comparison.acknowledgement}><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)}/><span>商品・型番・構成と、状態・期間・通貨の違いを確認しました</span></label>
    {acknowledged?<div className={comparison.grid}>
      <article><h4>{selected.sourceProvider==="aucfan_api"?"オークファン":"ヤフオク"}（JPY）</h4><p>中央値：{selected.medianPrice===null?"算出対象なし":`${selected.medianPrice.toLocaleString("ja-JP")} JPY`}</p><p>採用 {selected.includedCount} 件</p><p>確定日時：{selected.confirmedAt??"未記録"}</p>{selected.sourceLimitations.map(value=><p key={value}>{value}</p>)}</article>
      {(snapshot?.snapshotJson.statistics??[]).map(stat=><article key={stat.market}><h4>{ebayMarketLabels[stat.market]}（{stat.currency}）</h4><p>中央値：{stat.median??"算出対象なし"} {stat.median===null?"":stat.currency}</p><p>採用 {stat.includedCount} 件・要求ページ内の参考値</p></article>)}
    </div>:<p>条件差の確認後に、各取得元の金額を独立して表示します。</p>}</>:null}
  </section>;
}
