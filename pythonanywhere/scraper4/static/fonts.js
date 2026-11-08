(() => {
  const fonts={vazirmatn:'Vazirmatn, Tahoma, system-ui, sans-serif',sahel:'Sahel, Tahoma, system-ui, sans-serif',system:'Tahoma, system-ui, sans-serif'};
  const select=document.querySelector('#app-font');
  function apply(key){if(!Object.hasOwn(fonts,key))key='vazirmatn';document.documentElement.style.setProperty('--app-font',fonts[key]);if(select)select.value=key;return key;}
  let key='vazirmatn';try{key=localStorage.getItem('s4-app-font')||key;}catch{}
  apply(key);if(select)select.onchange=()=>{const value=apply(select.value);try{localStorage.setItem('s4-app-font',value);}catch{}};
})();
