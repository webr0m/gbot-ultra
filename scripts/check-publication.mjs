// Checks the actual Git index, including files force-added despite .gitignore.
import {spawnSync} from 'node:child_process';
const git=(args,input)=>{const r=spawnSync('git',args,{input,maxBuffer:64*1024*1024});if(r.status!==0)throw new Error('Git inspection failed');return r.stdout;};
const entries=git(['ls-files','--stage','-z']).toString().split('\0').filter(Boolean).map(line=>{const [meta,path]=line.split('\t');const [mode,oid,stage]=meta.split(' ');return {mode,oid,stage,path};});
const issues=[];
for(const e of entries){
 if(e.stage!=='0'||!['100644','100755'].includes(e.mode))issues.push({file:e.path,rule:'unsupported-index-entry'});
 if(/(^|\/)(?:\.deploy|node_modules|dist|coverage|backups?|data|screenshots|credentials)(\/|$)|\.(?:pem|key|p12|pfx|dump|backup|zip|sqlite3?|db|log)$/i.test(e.path)||/(^|\/)\.env(?:\.|$)/.test(e.path)&&e.path!=='.env.example')issues.push({file:e.path,rule:'private-or-generated-path'});
 if(e.path.endsWith('.sql')&&!/^db\/migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(e.path))issues.push({file:e.path,rule:'database-export'});
}
const unique=[...new Set(entries.map(e=>e.oid))],raw=git(['cat-file','--batch'],unique.join('\n')+'\n');let offset=0;const blobs=new Map();
for(const oid of unique){const end=raw.indexOf(10,offset),header=raw.subarray(offset,end).toString(),size=Number(header.split(' ')[2]);if(!Number.isSafeInteger(size))throw Error('Invalid Git object');offset=end+1;blobs.set(oid,raw.subarray(offset,offset+size).toString());offset+=size+1;}
const rules=[
 ['private-key',/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g],
 ['telegram-token',/\b\d{6,12}:[A-Za-z0-9_-]{25,}/g],
 ['openai-key',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
 ['groq-key',/\bgsk_[A-Za-z0-9]{20,}/g],
 ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})/g],
 ['gitlab-token',/\bglpat-[A-Za-z0-9_-]{20,}/g],
 ['aws-access-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
 ['hardcoded-installation-identity',/\bDEVELOPER_ID\s*=\s*[1-9]\d{5,}/g],
];
for(const e of entries){const text=blobs.get(e.oid)??'';for(const [rule,regex]of rules){regex.lastIndex=0;for(const match of text.matchAll(regex)){
 // JPEG's standard Huffman alphabet resembles a token; exempt only that exact public table sequence.
 if(rule==='telegram-token'&&/\.jpe?g$/i.test(e.path)&&match[0]===('456789:'+'CDEFGHIJSTUVWXYZcdefghijstuvwxyz'))continue;
 // Only visibly fictional test fixtures may resemble a credential. Gitleaks also runs independently.
 if(e.path.startsWith('tests/')&&/(?:QA_FAKE|FAKE_QA|NOT_REAL|TEST_TOKEN|fake[-_]token)/i.test(match[0]))continue;
 issues.push({file:e.path,line:text.slice(0,match.index).split('\n').length,rule});
 }} }
if(issues.length){for(const item of issues)console.error(JSON.stringify(item));process.exitCode=1;}
else console.log(JSON.stringify({publicationCheck:'passed',files:entries.length,valuesRedacted:true}));
