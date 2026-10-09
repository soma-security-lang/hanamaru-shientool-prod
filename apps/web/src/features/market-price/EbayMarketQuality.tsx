import type { EbayMarketStatistics } from "@hanamaru/contracts";
import styles from "./EbayMarketQuality.module.css";

const reasons:Record<string,string>={price_outlier:"価格の外れ値",product_mismatch:"商品条件不一致",product_confirmation_required:"商品根拠の確認待ち",product_excluded:"商品単位の手動除外",manual_excluded:"観測単位の手動除外",excluded_keyword:"除外キーワード",product_or_condition_mismatch:"商品・状態不一致",best_offer_accepted:"Best Offer成立価格が未確認",best_offer_unknown:"Best Offerの状態不明",price_range:"価格レンジ",price_missing:"価格欠損",price_invalid:"価格不正",currency_unknown:"通貨不明",currency_mismatch:"市場通貨不一致",observation_conflict:"取得ページ間の矛盾"};

/** Only display API/snapshot aggregates; no client-side price recomputation. */
export function EbayMarketQuality({stat}:{stat:EbayMarketStatistics}){
  const histogram=stat.histogram,location=stat.locationQuality,format=stat.buyingFormatQuality;
  return <section className={styles.quality} aria-label={`${stat.market}の価格品質`}>
    <dl><dt>中心価格帯（p25〜p75）</dt><dd>{stat.p25!=null&&stat.p75!=null?`${stat.p25} 〜 ${stat.p75} ${stat.currency}`:"未算出"}</dd>
      <dt>市場内重複除去後</dt><dd>{stat.uniqueObservations??"未記録"} 件</dd>
      <dt>除外件数</dt><dd>{stat.uniqueObservations==null?"未記録":stat.uniqueObservations-stat.includedCount} 件</dd></dl>
    <h4>根拠の確認状況</h4>
    {location?<><p>所在地判定率：{location.identifiedRate==null?"算出対象なし":`${(location.identifiedRate*100).toFixed(1)}%`}（取得・重複除去後 {location.denominator} 件）</p>
      <p>国が明示された出品 {location.explicitCountryCount} 件・所在地不明 {location.unknownCount} 件・所在地矛盾 {location.conflictingCount} 件</p></>:<p>この保存版には所在地判定率の記録がありません。</p>}
    {format?<><p>採用候補のオークション比率：{format.auctionRate==null?"算出対象なし":`${(format.auctionRate*100).toFixed(1)}%`}（採用 {format.denominator} 件）</p>
      <p>オークション {format.auctionCount} 件・固定価格 {format.fixedPriceCount} 件・形式不明 {format.unknownCount} 件</p></>:<p>この保存版には販売形式比率の記録がありません。</p>}
    <p>出品所在地は販売市場・購入者国・配送先ではありません。不明・矛盾だけでは価格を除外しません。</p>
    <h4>採用価格の分布</h4>
    {histogram?.bins.length?<table className={styles.distribution}><caption>この市場の採用 {histogram.populationCount} 件・{stat.currency}。下限以上、上限未満（最終区間のみ上限を含む）</caption>
      <thead><tr><th scope="col">価格区間</th><th scope="col">件数</th></tr></thead><tbody>{histogram.bins.map((bin,index)=><tr key={index}>
        <th scope="row">{bin.lower} 〜 {bin.upper}{bin.upperInclusive?"（上限を含む）":""}</th><td>{bin.count} 件</td>
      </tr>)}</tbody></table>:<p>{histogram?"採用価格がないため分布は算出できません。":"この保存版には価格分布の記録がありません。現在の候補から再作成はしません。"}</p>}
    <h4>除外の主理由</h4>
    {Object.keys(stat.primaryExclusionCounts??{}).length?<ul>{Object.entries(stat.primaryExclusionCounts).map(([reason,count])=><li key={reason}>{reasons[reason]??"その他の確認事項"}：{count} 件</li>)}</ul>:<p>除外の主理由はありません。</p>}
    <p>1候補に複数の理由がある場合も、主理由では1件として数えます。価格分布は最終採用集合であり、異なる市場・通貨は合算しません。</p>
  </section>;
}
