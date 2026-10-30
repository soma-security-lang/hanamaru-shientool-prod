import {cleanup,render,screen,within} from '@testing-library/react';
import {afterEach,describe,it,expect} from 'vitest';
import {renderToString} from 'react-dom/server';
import {PurchaseExperience,RankingTable} from './PurchaseExperience';
import {DailyPurchaseChart} from './DailyPurchaseChart';
afterEach(cleanup);
describe('初回の操作準備',()=>{
 it('操作準備前のSSRフォームでは金額・日付入力と保存を受け付けない',()=>{
  const container=document.createElement('div');container.innerHTML=renderToString(<PurchaseExperience/>);
  const form=container.querySelector('form')!;
  expect(form.querySelector('input[type="date"]')).toBeDisabled();
  expect(form.querySelector('input[type="number"]')).toBeDisabled();
  expect(form.querySelector('button')).toBeDisabled();
 });
});
describe('全件ランキング表示',()=>{
 it('105名と実績なしを表示し、上位100名で切らない',()=>{
  const rows=Array.from({length:105},(_,i)=>({id:String(i),name:`合成査定員${i+1}`,amount:String(10000-i),count:1,rank:i+1}));
  render(<RankingTable title="全拠点の査定員ランキング" rows={rows} unranked={[{id:'empty',name:'合成・実績未記録'}]}/>);
  const table=screen.getByRole('region',{name:'全拠点の査定員ランキング'});
  expect(within(table).getAllByRole('row')).toHaveLength(107);
  expect(within(table).getByText('105位')).toBeInTheDocument();
  expect(within(table).getByText('合成・実績未記録')).toBeInTheDocument();
  expect(within(table).getByText('確定実績なし')).toBeInTheDocument();
  expect(within(table).queryAllByRole('meter')).toHaveLength(0);
  expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
  expect(within(table).queryByText('比較グラフ')).not.toBeInTheDocument();
 });
 it('同順位と正確な巨大整数を表示する',()=>{
  render(<RankingTable title="比較" rows={[{id:'a',name:'合成A',amount:'9007199254740993',count:1,rank:1},{id:'b',name:'合成B',amount:'9007199254740993',count:1,rank:1}]}/>);
  expect(screen.getAllByText('1位')).toHaveLength(2);expect(screen.getAllByText('9,007,199,254,740,993円')).toHaveLength(2);
 });
});
describe('日別の縦棒グラフ',()=>{
 it('金額と日付の軸を示し、期間内の実績なしを0円にしない',()=>{
  render(<DailyPurchaseChart scopeName="全拠点合計" data={{startDate:'2026-05-20',endDate:'2026-05-22',branchOptions:[{id:'a',name:'合成A'}],cells:[{branchId:'a',branchName:'合成A',businessDate:'2026-05-20',amount:'100000',count:2},{branchId:'a',branchName:'合成A',businessDate:'2026-05-22',amount:'28000',count:1}]}}/>);
  expect(screen.getByRole('img')).toHaveAccessibleName(/全拠点合計.*縦軸は円/);
  expect(screen.getByText('買取金額（円）')).toBeInTheDocument();
  expect(screen.getByText('21日')).toBeInTheDocument();
  expect(screen.getByText('100,000円')).toBeInTheDocument();
  expect(screen.getByText('確定実績なし')).toBeInTheDocument();
  expect(screen.queryByText('0円')).not.toBeInTheDocument();
 });
 it('実績がなくても軸と全日を表示する',()=>{
  render(<DailyPurchaseChart scopeName="合成拠点" data={{startDate:'2026-05-20',endDate:'2026-05-21',branchOptions:[{id:'a',name:'合成A'}],cells:[]}}/>);
  expect(screen.getAllByText('確定実績なし')).toHaveLength(2);
  expect(screen.getByText('20日')).toBeInTheDocument();
  expect(screen.getByText('21日')).toBeInTheDocument();
 });
 it('同じ日の2拠点を合算せず分け、拠点選択で絞り込む',()=>{
  const data={startDate:'2026-05-20',endDate:'2026-05-20',branchOptions:[{id:'a',name:'合成A'},{id:'b',name:'合成B'}],cells:[{branchId:'a',branchName:'合成A',businessDate:'2026-05-20',amount:'35000',count:1},{branchId:'b',branchName:'合成B',businessDate:'2026-05-20',amount:'65000',count:1}]};
  const {rerender}=render(<DailyPurchaseChart scopeName="全拠点" data={data}/>);
  expect(screen.getByRole('list',{name:'グラフの拠点凡例'})).toHaveTextContent('1：合成A');
  expect(screen.getByRole('list',{name:'グラフの拠点凡例'})).toHaveTextContent('2：合成B');
  expect(screen.getByText('35,000円')).toBeInTheDocument();expect(screen.getByText('65,000円')).toBeInTheDocument();
  expect(screen.queryByText('100,000円')).not.toBeInTheDocument();
  rerender(<DailyPurchaseChart scopeName="合成B" branchId="b" data={data}/>);
  expect(screen.getByRole('list',{name:'グラフの拠点凡例'})).not.toHaveTextContent('合成A');
  expect(screen.queryByText('35,000円')).not.toBeInTheDocument();
 });
});
