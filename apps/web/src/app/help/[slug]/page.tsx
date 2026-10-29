import HelpHost from '@/lib/help/HelpHost';export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;return <HelpHost slug={slug}/>;}
