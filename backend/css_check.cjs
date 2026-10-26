/* Parse only: no plugins, imports, source maps, network, or generated-code execution. */
const fs=require('node:fs');
const {parse,Input,tokenize}=require('./vendor/postcss-parser.cjs');

// PostCSS intentionally leaves some value syntax raw. Match delimiter tokens
// too, without counting punctuation inside strings, comments or URL tokens.
function delimiters(css){
  const input=new Input(css,{map:false}),expected={'(':')','[':']','{':'}'};
  const frames=[{stream:tokenize(input),base:0,previous:'',depth:0}],stack=[];
  while(frames.length){
    const frame=frames.at(-1),token=frame.stream.nextToken();
    if(!token){
      if(stack.length>frame.depth)throw input.error(stack.at(-1).kind==='{'?'Unclosed block':'Unclosed bracket',stack.at(-1).offset);
      frames.pop();continue;
    }
    const [kind,value,start]=token,offset=frame.base+(start||0);
    if(kind==='brackets'&&frame.previous.toLowerCase()!=='url'){
      frames.push({stream:tokenize(new Input(value.slice(1,-1),{map:false})),base:offset+1,previous:'',depth:stack.length});
    }else if(expected[kind])stack.push({kind,offset,close:expected[kind]});
    else if([')',']','}'].includes(kind)){
      if(stack.length<=frame.depth||stack.at(-1).close!==kind)throw input.error('Unexpected '+kind,offset);
      stack.pop();
    }
    frame.previous=kind==='word'?value:'';
  }
  if(stack.length)throw input.error(stack.at(-1).kind==='{'?'Unclosed block':'Unclosed bracket',stack.at(-1).offset);
}

function check(unit){
  const prefix=unit.declarations?'x{':'',css=prefix+unit.text+(unit.declarations?'}':'');
  try{
    // Parse first so diagnostics identify the unclosed rule, as in the editor.
    const root=parse(css,{map:false});delimiters(css);
    const invalid=unit.declarations?root.nodes.find(node=>node.type!=='rule')||root.first?.nodes?.find(node=>!['decl','comment'].includes(node.type)):root.nodes.find(node=>node.type==='decl');
    if(invalid)throw invalid.error(unit.declarations?'Only declarations in style attribute':'Declaration outside rule');
  }catch(error){
    if(error.name!=='CssSyntaxError')throw error;
    const line=error.line||1,column=error.column||1;
    const offset=css.split('\n').slice(0,line-1).reduce((total,row)=>total+row.length+1,0)+column-1-prefix.length;
    return {offset:Math.max(0,Math.min(unit.text.length,offset)),reason:error.reason};
  }
}

const units=JSON.parse(fs.readFileSync(0,'utf8'));
for(let index=0;index<units.length;index++){
  const issue=check(units[index]);
  if(issue){process.stdout.write(JSON.stringify({index,...issue}));process.exit(0);}
}
process.stdout.write('{}');
