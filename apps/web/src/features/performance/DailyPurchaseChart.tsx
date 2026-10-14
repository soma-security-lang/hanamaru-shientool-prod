import type {PurchasePerformanceDto} from '@hanamaru/contracts';
import styles from './PurchaseExperience.module.css';

export function DailyPurchaseChart({data,scopeName,branchId=''}:{data:Pick<PurchasePerformanceDto,'startDate'|'endDate'|'cells'|'branchOptions'>;scopeName:string;branchId?:string}) {
 const days:string[]=[];
 for(const d=new Date(`${data.startDate}T00:00:00Z`);d.toISOString().slice(0,10)<=data.endDate;d.setUTCDate(d.getUTCDate()+1))days.push(d.toISOString().slice(0,10));
 const branches=data.branchOptions.filter(b=>!branchId||b.id===branchId);
 const values=new Map<string,bigint>();
 for(const cell of data.cells){const key=`${cell.branchId}:${cell.businessDate}`;values.set(key,(values.get(key)??BigInt(0))+BigInt(cell.amount));}
 const max=Math.max(1,...data.cells.filter(c=>!branchId||c.branchId===branchId).map(row=>Number(values.get(`${row.branchId}:${row.businessDate}`))));
 const magnitude=10**Math.floor(Math.log10(max/4));
 const step=[1,2,5,10].map(n=>n*magnitude).find(n=>n>=max/4)??max;
 const ceiling=Math.max(4,step*4);
 const width=Math.max(640,days.length*Math.max(28,branches.length*18)+110),left=90,right=20,top=40,height=240,baseline=top+height;
 const slot=(width-left-right)/days.length;
 const branchClass=(id:string)=>[styles.seriesBlue,styles.seriesGreen,styles.seriesAmber,styles.seriesPurple][data.branchOptions.findIndex(b=>b.id===id)%4];
 return <section className={styles.chartCard}>
  <h2>日ごとの買取金額の推移</h2>
  <p>{branchId?scopeName:'全拠点を拠点別に比較'}の確定買取金額。縦軸：金額（円）／横軸：業務日。</p>
  <ul className={styles.chartLegend} aria-label="グラフの拠点凡例">{branches.map((b,i)=><li key={b.id}><span className={`${styles.legendSwatch} ${branchClass(b.id)}`} aria-hidden="true"/>{i+1}：{b.name}</li>)}</ul>
  <p className={styles.chartHint}>日付ごとに拠点の棒を並べています。棒の番号は凡例の拠点番号です。下端の点線は確定実績なし（0円とは異なります）。横にスクロールして全日を確認できます。</p>
  <div className={styles.chartFrame}><div className={styles.chartScroll} role="region" aria-label="日別の買取金額グラフ" tabIndex={0}>
   <svg role="img" aria-label={`${scopeName}の日ごとの買取金額の推移。縦軸は円、横軸は業務日。詳細は下の日別金額一覧を参照。`} viewBox={`0 0 ${width} 350`} style={{minWidth:width}}>
    {[0,1,2,3,4].map(i=>{const y=baseline-height*i/4;return <line key={i} x1={left} x2={width-right} y1={y} y2={y} className={styles.gridLine}/>;})}
    {days.map((day,i)=><g key={day}>{branches.map((b,j)=>{const amount=values.get(`${b.id}:${day}`),unit=slot/Math.max(1,branches.length),x=left+slot*i+unit*(j+.5),barHeight=amount!==undefined?Number(amount)/ceiling*height:0;return <g key={b.id}>
     <title>{day}・{b.name}：{amount!==undefined?`${amount.toLocaleString('ja-JP')}円`:'確定実績なし'}</title>
     <rect x={x-unit*.35} y={amount!==undefined?baseline-barHeight:baseline-4} width={unit*.7} height={amount!==undefined?Math.max(1,barHeight):4} rx={2} className={amount!==undefined?branchClass(b.id):styles.missingBar}/>
     <text x={x} y={baseline+16} textAnchor="middle" className={styles.axisText}>{j+1}</text>
    </g>;})}<text x={left+slot*(i+.5)} y={baseline+38} textAnchor="middle" className={styles.axisText}>{Number(day.slice(8))}日</text></g>)}
    <text x={(left+width-right)/2} y={340} textAnchor="middle" className={styles.axisText}>業務日（{data.startDate}〜{data.endDate}）</text>
   </svg>
  </div><svg className={styles.chartAxis} aria-hidden="true" viewBox="0 0 90 350"><text x={0} y={20} className={styles.axisText}>買取金額（円）</text>{[0,1,2,3,4].map(i=><text key={i} x={80} y={baseline-height*i/4+5} textAnchor="end" className={styles.axisText}>{Math.round(ceiling*i/4).toLocaleString('ja-JP')}</text>)}</svg></div>
  <details className={styles.chartValues}><summary>拠点別・日別の金額を一覧で確認</summary><dl>{days.flatMap(day=>branches.map(b=>{const amount=values.get(`${b.id}:${day}`);return <div key={`${b.id}:${day}`}><dt>{day}・{b.name}</dt><dd>{amount!==undefined?`${amount.toLocaleString('ja-JP')}円`:'確定実績なし'}</dd></div>;}))}</dl></details>
 </section>;
}
