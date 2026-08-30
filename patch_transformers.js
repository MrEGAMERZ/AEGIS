const fs = require('fs');
let code = fs.readFileSync('src/vendor/transformers.min.js', 'utf8');

const pfRegex = /pf=async\(e,t,r,n\)=>\{let s=To[^}]+\}\}\}/;
if (pfRegex.test(code)) {
    code = code.replace(pfRegex, 'pf=async(e,t,r,n)=>{return[void 0,To]}');
    console.log("Patched pf!");
} else {
    console.log("pf not found!");
}

const _fRegex = /_f=async\(\)=>\{[^}]+\}/;
if (_fRegex.test(code)) {
    code = code.replace(_fRegex, '_f=async()=>{return[void 0,ko()]}');
    console.log("Patched _f!");
} else {
    console.log("_f not found!");
}

const xoRegex = /xo=async e=>\{let t=await\(await fetch\(e,\{credentials:"same-origin"\}\)\)\.blob\(\);return URL\.createObjectURL\(t\)\}/;
if (xoRegex.test(code)) {
    code = code.replace(xoRegex, 'xo=async e=>{throw new Error("blob:")}');
    console.log("Patched xo!");
} else {
    console.log("xo not found!");
}

fs.writeFileSync('src/vendor/transformers.min.js', code);
