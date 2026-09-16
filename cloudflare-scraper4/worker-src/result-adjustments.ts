/** Results-stage pricing. Reapplying settings always uses the saved baseline. */
export function applyResultAdjustments<T extends {title:string;price:number;priceText:string}>(product:T, profile:{titleSuffix:string;priceMode:string;priceValue:number;roundPrice:number}, suffixFormats?:string):T {
  const row=product as T & {sku?:string;sourceKey?:string;variationPrices?:Record<string,number>;variationGroups?:Array<{prices?:Record<string,number>}>;resultBase?:{title:string;price:number;priceText:string;variationPrices?:Record<string,number>;groupPrices?:Array<Record<string,number>|undefined>};resultApplied?:{title:string;price:number}};
  row.resultBase ||= {title:row.title,price:Number(row.price)||0,priceText:row.priceText};
  const base=row.resultBase;
  const adjust=(input:number)=>{
    let price=Number.isFinite(Number(input))&&Number(input)>0?Number(input):0;
    const value=Number(profile.priceValue)||0;
    if(price>0){
      if(profile.priceMode==='add')price+=value;
      if(profile.priceMode==='percent')price*=1+value/100;
      if(profile.priceMode==='multiply')price*=value;
      if(profile.roundPrice>0)price=Math.ceil(price/profile.roundPrice)*profile.roundPrice;
    }
    return Number.isFinite(price)?Math.max(0,Math.round(price)):0;
  };
  row.price=adjust(base.price);
  const prices=(values:Record<string,number>)=>Object.fromEntries(Object.entries(values).map(([key,value])=>[key,adjust(value)]));
  if(row.variationPrices){base.variationPrices||={...row.variationPrices};row.variationPrices=prices(base.variationPrices)}
  if(row.variationGroups){base.groupPrices||=row.variationGroups.map(group=>group.prices?{...group.prices}:undefined);row.variationGroups=row.variationGroups.map((group,i)=>({...group,...(base.groupPrices?.[i]?{prices:prices(base.groupPrices[i]!)}:{})}))}
  row.priceText=row.price===base.price?base.priceText:row.price.toLocaleString('fa-IR')+(/(?:ریال|rial|irr)/i.test(base.priceText||'')?' ریال':' تومان');
  let suffix=String(profile.titleSuffix||'');
  if(!suffix&&suffixFormats!==undefined&&!/[\[(]\s*(?:کد|كد|code|sku)\s*[:：#-]?[^\])]+[\])]\s*$/iu.test(base.title)){
    const code=String(row.sku||row.sourceKey||'').trim().slice(0,20);
    const format=String(suffixFormats||'').split(/[,،|\n]+/).map(x=>x.trim()).find(x=>/[xX]/.test(x))||'(کد:x)';
    if(code)suffix=' '+format.replace(/[xX]+/,code);
  }
  row.title=(base.title+suffix).replace(/[\u200c\u200d\u200e\u200f\ufeff]/g,' ').replace(/\s+/g,' ').trim().slice(0,300);
  row.resultApplied={title:row.title,price:row.price};
  return product;
}
