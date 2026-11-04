const fs = require("node:fs");
const YAML = require("C:/Users/admin/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/yaml");
const doc = YAML.parse(fs.readFileSync("C:/Users/admin/.dsh/.credentials.yaml","utf8"));
function shape(v, d=0){
  if (v===null||v===undefined) return String(v);
  if (typeof v==="string") return `string(len=${v.length})`;
  if (typeof v!=="object") return typeof v+"="+String(v);
  if (Array.isArray(v)) return "["+v.map(x=>shape(x,d+1)).join(", ")+"]";
  const out={};
  for (const [k,val] of Object.entries(v)) out[k]=shape(val,d+1);
  return out;
}
console.log(JSON.stringify(shape(doc),null,2));
