// Fake image transport. Never forwards stdin or invokes a provider.
import {readFileSync,readdirSync} from 'node:fs';
const [provider,...argv]=process.argv.slice(2);
if(readdirSync(process.cwd()).length)process.exit(90);
const input=readFileSync(0,'utf8');
if(provider==='claude')console.log(JSON.stringify({argv,body:JSON.parse(input)}));
else{
 const image=argv[argv.indexOf('--image')+1];
 console.log(JSON.stringify({argv,image,cwd:argv[argv.indexOf('-C')+1],body:input,contents:readFileSync(image).toString('base64')}));
}
