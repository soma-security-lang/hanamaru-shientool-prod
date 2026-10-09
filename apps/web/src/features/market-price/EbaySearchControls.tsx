"use client";
import { ebayConditions, ebayMarketCurrencies, ebayMarkets, type EbaySearchSelection } from "@hanamaru/contracts";
import styles from "./MarketPriceExperience.module.css";

export const ebayMarketLabels = { us: "米国", uk: "英国", ca: "カナダ", au: "オーストラリア", de: "ドイツ", fr: "フランス", it: "イタリア", es: "スペイン" } as const;
const conditionLabels = { new: "新品", open_box: "開封済み・未使用", refurbished: "再生品", used: "中古", for_parts: "部品用・不動品" } as const;
export const initialEbaySelection: EbaySearchSelection = { markets: [...ebayMarkets], conditions: ["used"], buyingFormat: null, consumptionConfirmed: false };

export function EbaySearchControls({ value, onChange, acquisitionMode="reuse" }: { value: EbaySearchSelection; onChange: (value: EbaySearchSelection) => void; acquisitionMode?:"reuse"|"latest" }) {
  const change = (patch: Partial<EbaySearchSelection>) => onChange({ ...value, ...patch, consumptionConfirmed: false });
  return <section className={styles.panel} aria-label="eBay検索条件">
    <h2>eBayの対象市場と取得枠</h2>
    <p>出品所在地は全世界。各市場の最新ページを最大200行取得します。全世界の全取引、直近90日の全件取得ではありません。</p>
    <fieldset className={styles.compactConditions}><legend>対象市場（複数選択）</legend>
      {ebayMarkets.map(market => <label key={market}><input type="checkbox" checked={value.markets.includes(market)} onChange={() => change({ markets: value.markets.includes(market) ? value.markets.filter(item => item !== market) : [...value.markets, market] })}/>{ebayMarketLabels[market]}（{ebayMarketCurrencies[market]}）</label>)}
    </fieldset>
    <fieldset className={styles.compactConditions}><legend>eBayの商品状態（日本の状態区分とは別）</legend>
      {ebayConditions.map(condition => <label key={condition}><input type="checkbox" checked={value.conditions.includes(condition)} onChange={() => change({ conditions: value.conditions.includes(condition) ? value.conditions.filter(item => item !== condition) : [...value.conditions, condition] })}/>{conditionLabels[condition]}</label>)}
    </fieldset>
    <label className={styles.editQuery}>販売形式<select value={value.buyingFormat ?? ""} onChange={event => change({ buyingFormat: event.target.value as EbaySearchSelection["buyingFormat"] || null })}>
      <option value="">指定しない</option><option value="auction">オークション</option><option value="buy_it_now">固定価格</option><option value="best_offer">Best Offer</option>
    </select></label>
    <p aria-live="polite">初回最大 {value.markets.length} 枠・最大 {value.markets.length * 200} 受信行。0件や外部キャッシュでも枠を消費する場合があります。</p>
    <p>{acquisitionMode==="latest"?"最新取得では自社保存ページを再利用せず、新規検索枠を使用します。":"同じ確認条件で24時間以内の閲覧可能な自社保存ページがある市場は再利用し、新規検索枠を消費しません。最新の再取得は履歴・結果画面から別途確認して開始します。"}</p>
    <label><input type="checkbox" checked={value.consumptionConfirmed} disabled={!value.markets.length || !value.conditions.length} onChange={event => onChange({ ...value, consumptionConfirmed: event.target.checked })}/>対象市場・状態と最大消費枠を確認しました</label>
    <p>市場・通貨ごとに集計し、世界共通中央値や円換算は行いません。Best Offerの実決済価格は保証できないため、必須除外の対象になります。</p>
  </section>;
}
