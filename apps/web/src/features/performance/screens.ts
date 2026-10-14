import type {ScreenSpec} from '@/lib/prototype/types';
const common={eyebrow:'買取実績',roles:['assessor','manager'] as ScreenSpec['roles'],primaryAction:'実績を確認',pocElements:[],metrics:[],sections:[]};
export const performanceScreens:ScreenSpec[]=[
 {...common,id:'SCR-023',name:'買取実績',summary:'本人の取引を下書き・確認・確定し、履歴を保持します。',routes:['/purchase-results'],kind:'purchaseResults',featureFlag:'purchase_results'},
 {...common,id:'SCR-024',name:'実績・ランキング',summary:'同一組織の確定取引を日次・週次・月次で集計し、全拠点の順位を確認します。',routes:['/performance'],kind:'performance',featureFlag:'purchase_performance'},
];
