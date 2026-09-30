"use client";

import {useEffect,useRef,useState} from "react";
import {resources,type VisitProductDto} from "@/lib/api/resources";
import styles from "./VisitProducts.module.css";

const empty={productName:"",quantity:"1",conditionNote:"",accessoriesNote:""};

export function VisitProducts({visitId}:{visitId:string}){
  const [products,setProducts]=useState<VisitProductDto[]>([]);
  const [form,setForm]=useState(empty);
  const [editing,setEditing]=useState<VisitProductDto|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const pendingOperation=useRef<{body:string;key:string}|null>(null);

  async function refresh(){
    const result=await resources.visitProducts(visitId);
    setProducts(result.items);
  }
  useEffect(()=>{
    let live=true;
    void resources.visitProducts(visitId).then(result=>{if(live){setProducts(result.items);setError("");}})
      .catch(()=>{if(live)setError("商品カードを読み込めませんでした。再読込してください。");})
      .finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[visitId]);
  function edit(product:VisitProductDto){
    pendingOperation.current=null;
    setEditing(product);
    setForm({productName:product.productName,quantity:String(product.quantity),conditionNote:product.conditionNote??"",accessoriesNote:product.accessoriesNote??""});
    setError("");
  }
  async function save(event:React.FormEvent){
    event.preventDefault();
    const quantity=Number(form.quantity);
    if(!form.productName.trim()||!Number.isInteger(quantity)||quantity<1||quantity>100000){setError("品名と数量を確認してください。");return;}
    setSaving(true);setError("");
    const input={productName:form.productName.trim(),quantity,conditionNote:form.conditionNote.trim()||null,accessoriesNote:form.accessoriesNote.trim()||null};
    const body=JSON.stringify({visitId,productId:editing?.id??null,expectedLockVersion:editing?.lockVersion??null,input});
    if(pendingOperation.current?.body!==body)pendingOperation.current={body,key:crypto.randomUUID()};
    const operationKey=pendingOperation.current.key;
    try{
      if(editing)await resources.updateVisitProduct(visitId,editing.id,{...input,expectedLockVersion:editing.lockVersion},operationKey);
      else await resources.createVisitProduct(visitId,input,operationKey);
      await refresh();setForm(empty);setEditing(null);pendingOperation.current=null;
    }catch{setError("保存できませんでした。商品情報を再読み込みし、内容を確認してください。新規登録を再送する前に一覧を確認してください。");await refresh().catch(()=>undefined);}
    finally{setSaving(false);}
  }
  return <section className={styles.section} aria-labelledby="visit-products-title">
    <div className={styles.header}><div><h2 id="visit-products-title">訪問する商品</h2><p>商品ごとに品名・数量・状態・付属品を記録します。PDFからの抽出値は原本と照合してから入力してください。</p></div><button type="button" className={styles.secondary} onClick={()=>void refresh().catch(()=>setError("再読込できませんでした。"))}>再読込</button></div>
    {loading?<p role="status">商品カードを読み込んでいます。</p>:null}
    {error?<p className={styles.error} role="alert">{error}</p>:null}
    <div className={styles.cards}>
      {products.map((product,index)=><article key={product.id} className={styles.card}>
        <div className={styles.cardHead}><strong>{index+1}. {product.productName}</strong><span>{product.quantity}点</span></div>
        <dl><div><dt>状態</dt><dd>{product.conditionNote??"未入力"}</dd></div><div><dt>付属品</dt><dd>{product.accessoriesNote??"未入力"}</dd></div></dl>
        <button type="button" className={styles.secondary} onClick={()=>edit(product)}>修正する</button>
      </article>)}
      {!loading&&products.length===0?<p className={styles.empty}>商品カードはありません。複数の商品を一件ずつ登録できます。</p>:null}
    </div>
    <form className={styles.form} onSubmit={event=>void save(event)}>
      <h3>{editing?"商品カードを修正":"商品カードを追加"}</h3>
      <label>商品名<input required maxLength={300} value={form.productName} onChange={event=>setForm(current=>({...current,productName:event.target.value}))}/></label>
      <label>数量<input required type="number" min={1} max={100000} value={form.quantity} onChange={event=>setForm(current=>({...current,quantity:event.target.value}))}/></label>
      <label>状態・傷など<textarea maxLength={1000} value={form.conditionNote} onChange={event=>setForm(current=>({...current,conditionNote:event.target.value}))}/></label>
      <label>付属品<textarea maxLength={1000} value={form.accessoriesNote} onChange={event=>setForm(current=>({...current,accessoriesNote:event.target.value}))}/></label>
      <div className={styles.actions}><button className={styles.primary} type="submit" disabled={saving}>{saving?"保存中…":editing?"修正を保存":"商品を追加"}</button>{editing?<button type="button" className={styles.secondary} onClick={()=>{setEditing(null);setForm(empty);pendingOperation.current=null;}}>修正をやめる</button>:null}</div>
    </form>
  </section>;
}
