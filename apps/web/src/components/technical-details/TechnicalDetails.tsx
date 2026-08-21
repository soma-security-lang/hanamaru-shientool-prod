"use client";
import {useState} from "react";
import styles from "./TechnicalDetails.module.css";

export interface TechnicalDetailItem {label:string;value:string|null|undefined;copyable?:boolean;}
export function TechnicalDetails({summary="技術詳細",items}:{summary?:string;items:TechnicalDetailItem[]}){
  const [announcement,setAnnouncement]=useState("");
  const visible=items.filter((item):item is TechnicalDetailItem&{value:string}=>Boolean(item.value));
  if(!visible.length)return null;
  async function copy(item:TechnicalDetailItem&{value:string}){try{await navigator.clipboard.writeText(item.value);setAnnouncement(`${item.label}をコピーしました`);}catch{setAnnouncement(`${item.label}をコピーできませんでした`);}}
  return <details className={styles.details}><summary>{summary}</summary><dl className={styles.items}>{visible.map(item=><div className={styles.item} key={`${item.label}:${item.value}`}><dt>{item.label}</dt><dd>{item.value}</dd>{item.copyable?<button className={styles.copy} type="button" onClick={()=>void copy(item)} aria-label={`${item.label}をコピー`}>コピー</button>:null}</div>)}</dl><span className={styles.live} role="status" aria-live="polite">{announcement}</span></details>;
}
