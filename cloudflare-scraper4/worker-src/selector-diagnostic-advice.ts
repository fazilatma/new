/** Read-only advice; never replace a user's custom selectors or parser. */
export function selectorDiagnosticAdvice(selectors:Record<string,any>,products:any[]){
 const out:string[]=[],container=String(selectors?.container||'');
 if(/(?:a|article|li|div)\[1\]|:nth-(?:child|of-type)\(1\)/i.test(container))out.push('سلکتور ظرف به عضو اول محدود است؛ برای استخراج همهٔ کارت‌ها، ظرف تکرارشونده را انتخاب کنید، نه a[1] یا nth-child(1). تغییر خودکار انجام نشد.');
 if(products.length&&products.every(p=>!p.url)&&/article/i.test(container))out.push('اگر article داخل a است، لینک والد بیرون محدودهٔ کارت قرار دارد. خود a پوشانندهٔ محصول را ظرف بگیرید و لینک را روی همان a آزمایش کنید.');
 if(products.length&&products.every(p=>!p.image))out.push('تصویر از هیچ کارت استخراج نشد. در DOM رندرشده خود img یا picture img را انتخاب کنید و src، data-src یا srcset را بررسی کنید؛ انتخاب div تصویر بدون ویژگی تصویر کافی نیست.');
 if(products.length&&products.every(p=>!p.price&&!p.url&&!p.image))out.push('فقط عنوان استخراج شده است؛ این نتیجه یک محصول کامل نیست. قیمت، لینک و تصویر را روی همان کارت رندرشده جداگانه آزمایش کنید.');
 return out;
}
export function initialSelectorEvidenceApplies(engine?:string){return !['playwright','puppeteer','crawlee_playwright','network_api'].includes(engine||'')}
