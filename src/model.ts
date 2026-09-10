export type ProfileId = 'practical' | 'brief';
export type Source = {id:string; platform:string; author:string; title:string; body:string; kind:string; color:string; topic:string};
export const sources:Source[] = [
{id:'s1',platform:'小红书',author:'林序的开发手记 · 虚构博主',title:'让 AI 读懂项目之前，先给它一张地图',body:'我在一个示例仓库里放了项目入口、验证命令和边界说明，再让 Patchwork 帮我修改一个表单。它开始先看入口，再改文件。但约束写得越长不一定越好：旧命令会把它带偏。我的做法是保留一页说明，每次改完都跑测试。这是一次个人实验，还不能说明适用于所有仓库。',kind:'图文',color:'rose',topic:'AI 编程工具'},
{id:'s2',platform:'GitHub',author:'patchwork-labs · 虚构项目',title:'Patchwork：把仓库上下文交给编程助手',body:'示例 README：Patchwork 是一个整理仓库上下文的实验工具。它读取项目入口和用户指定的目录，生成一份供编程助手阅读的摘要。当前支持本地文本文件，不会自动理解业务规则，也不会代替测试。示例版本新增了目录排除配置。',kind:'仓库',color:'ink',topic:'GitHub Trending'},
{id:'s3',platform:'Hacker News',author:'dev_nora · 虚构讨论',title:'上下文越多，编程助手就越可靠吗？',body:'模拟讨论里，几位开发者提到：精简且及时维护的项目说明比堆积文档更有用。也有人报告过时说明造成错误修改。讨论没有对照实验，不能证明普遍的效率提升。共同建议是用小任务验证，保留人工审查。',kind:'讨论',color:'orange',topic:'AI 编程工具'},
{id:'s4',platform:'产品社区',author:'Build Notes · 虚构团队',title:'TinyShip 把产品反馈接回下一次构建',body:'TinyShip 是一个虚构的反馈整理产品。示例团队把反馈按用户任务分组，再选出一个问题做原型验证。它不自动决定优先级；团队仍要判断反馈是否代表目标用户。这个案例展示从反馈到构建的一种做法。',kind:'文章',color:'blue',topic:'产品构建'},
{id:'s5',platform:'技术博客',author:'模型观察室 · 虚构作者',title:'新模型发布之后，先看它在哪些任务上有用',body:'示例新闻介绍一个虚构模型 Cedar 的更新：支持更长的输入和结构化输出。作者建议先用自己的代码阅读、测试生成和摘要任务做比较。发布方样例不能替代个人任务验证，本文不包含真实模型评测数据。',kind:'文章',color:'green',topic:'AI 新闻'},
{id:'s6',platform:'产品社区',author:'Maker Field · 虚构作者',title:'新工具开始围绕一个具体任务设计',body:'示例观察收录了 TinyShip 和 Patchwork 两个虚构产品。它们分别聚焦反馈整理和仓库上下文。样本很小，只能作为探索任务型工具的线索，不能据此判断整个市场趋势。',kind:'观察',color:'purple',topic:'新产品趋势'}];
export const profiles = {
 practical:{name:'林序 · 实操笔记',initial:'林',tag:'从一个问题讲起',description:'先说开发现场遇到了什么，再解释方法，最后给一个能动手的小实验。',rules:['具体问题开场','方法和局限一起说','以一个小实验收尾'],samples:[{title:'我把项目说明缩到一页之后',text:'以前每次都要解释目录。现在只留下入口、边界和测试命令。先在一个小改动上试，再看是否值得保留。'},{title:'别急着让 AI 改整个模块',text:'先挑一个表单，把通过条件写清楚。改完跑测试，再读差异。任务小一点，问题更容易看见。'},{title:'工具好不好，拿自己的任务试',text:'演示很顺不代表适合你的项目。用同一个小任务对比，记录失败，下一次才知道要改什么。'}]},
 brief:{name:'周知 · 技术简报',initial:'周',tag:'结论、依据、边界',description:'先给值得关注的结论，再压缩证据，明确哪些信息还不能确定。',rules:['一句话交代变化','区分事实与观点','保留不确定性'],samples:[{title:'本周工具观察',text:'变化：工具开始聚焦具体任务。依据：两个项目样例。边界：样本很小，不能推断市场。'},{title:'一次更新，三个要点',text:'新增了什么，适合谁，暂时缺什么。把发布说明与实际测试分开。'},{title:'值得关注，不等于立即采用',text:'先读来源，再用自己的任务验证。没有独立评测时，不把演示当成结论。'}]}
};
export type Topic = {id:string;name:string;description:string;profile:ProfileId;frequency:string;platforms:string[];enabled:boolean};
export type Run = {id:string;topicId:string;profile:ProfileId;sourceIds:string[];status:'success'|'partial'|'empty'|'failed';platforms:string[]};
export type Entry = {id:string;runId:string;topicId:string;profile:ProfileId;sourceIds:string[];bookmarked:boolean};
export type State = {topics:Topic[];parsed:boolean;assigned:string|null;extracted:ProfileId[];runs:Run[];entries:Entry[];serial:number};
export const initialState = ():State => ({topics:[
{id:'t1',name:'AI 编程工具',description:'关注能进入日常开发流程的 AI 工具、实践与局限。',profile:'practical',frequency:'每天 09:00',platforms:['GitHub','小红书','Hacker News'],enabled:true},
{id:'t2',name:'GitHub Trending',description:'发现值得读源码、动手试的开源项目。',profile:'brief',frequency:'每天 09:00',platforms:['GitHub'],enabled:true},
{id:'t3',name:'产品构建',description:'从用户反馈、原型到发布，学习真实的构建方法。',profile:'practical',frequency:'每周一 09:00',platforms:['产品社区'],enabled:true},
{id:'t4',name:'AI 新闻',description:'理解模型与工具更新对开发工作的实际影响。',profile:'brief',frequency:'每天 09:00',platforms:['技术博客'],enabled:true},
{id:'t5',name:'新产品趋势',description:'观察新产品在解决什么问题，适合谁。',profile:'brief',frequency:'每周一 09:00',platforms:['产品社区'],enabled:false}],parsed:true,assigned:'t1',extracted:['practical','brief'],runs:[{id:'r0',topicId:'t1',profile:'practical',sourceIds:['s1','s2','s3'],status:'success',platforms:['GitHub','小红书','Hacker News']}],entries:[{id:'f0',runId:'r0',topicId:'t1',profile:'practical',sourceIds:['s1','s2','s3'],bookmarked:false}],serial:1});
export function collect(state:State, topicId:string, scenario:Run['status']):State {
 const topic=state.topics.find(t=>t.id===topicId); if(!topic) return state;
 let selected=sources.filter(s=>topic.platforms.includes(s.platform) && (s.topic===topic.name || (topic.id==='t1' && ['s1','s2','s3'].includes(s.id))));
 if(scenario==='failed'||scenario==='empty') selected=[];
 if(scenario==='partial') selected=selected.filter(s=>s.platform!==topic.platforms[topic.platforms.length-1]);
 const status=selected.length===0 && scenario!=='failed'?'empty':scenario;
 return {...state,serial:state.serial+1,runs:[{id:`r${state.serial}`,topicId,profile:topic.profile,sourceIds:selected.map(s=>s.id),status,platforms:[...topic.platforms]},...state.runs]};
}
export function generate(state:State,runId:string):State {const run=state.runs.find(r=>r.id===runId);if(!run||!run.sourceIds.length)return state;return {...state,serial:state.serial+1,entries:[{id:`f${state.serial}`,runId,topicId:run.topicId,profile:run.profile,sourceIds:[...run.sourceIds],bookmarked:false},...state.entries]};}
const distilled:Record<string,[string,string]>={
 s1:['先整理项目入口、修改边界和测试命令，再交给编程助手。一位示例开发者这样完成了表单改动，但这只是个人实验；说明过时反而会把工具带偏。','实践线索：一页项目说明帮助示例作者开展表单修改。局限：单次个人实验，效果不能推广到所有仓库。'],
 s2:['Patchwork 帮你把本地文件整理成上下文摘要，并允许排除不相关目录。它减少的是整理材料的工作，业务判断和测试仍要自己负责。','工具变化：虚构项目 Patchwork 新增目录排除配置，支持本地文本摘要。它不理解业务规则，也不代替测试。'],
 s3:['社区讨论提醒了一件事：文档不在多，而在是否准确。先用一个小任务确认说明仍然有效，再逐步扩大使用范围。','讨论观点：几位示例开发者倾向精简且及时维护的上下文。没有对照实验，不能据此声称效率提升。'],
 s4:['先把反馈按用户任务归组，再挑一个问题做原型。TinyShip 的示例团队用这种方式缩小下一步范围；优先级仍由团队判断。','构建方法：TinyShip 示例将反馈按任务归组，再验证单个问题。工具不代替团队决定优先级。'],
 s5:['面对 Cedar 这样的示例更新，先别被更长输入吸引。拿自己的代码阅读、测试生成或摘要任务验证，看看新能力是否用得上。','示例更新：Cedar 支持更长输入与结构化输出。暂无真实评测，发布方示例不能证明它适合你的任务。'],
 s6:['Patchwork 只整理仓库上下文，TinyShip 只整理反馈。可以从这两个小样本观察任务型工具，但判断趋势前还需要更多案例。','产品线索：两个虚构样例都聚焦具体任务。样本不足以代表市场，可作为进一步探索的起点。']
};
export function story(entry:Entry) {const refs=sources.filter(s=>entry.sourceIds.includes(s.id));const ai=refs.some(s=>['s1','s2','s3'].includes(s.id));return {
 title:ai?(entry.profile==='practical'?'给 AI 一张项目地图，再让它动手':'仓库上下文工具值得试，效果仍需自己验证'):refs[0]?.title??'这次没有可用素材',
 intro:ai?(entry.profile==='practical'?'每次让编程助手改代码，都要重新解释项目？可以先试着把入口、边界和验证命令放到一页说明里。比起直接换一个工具，这件小事更容易开始。':'这组示例材料的共同线索是：明确、及时维护的项目上下文可能更有用。它提供了一种实践方向，还不足以证明普遍的效率提升。'):refs[0]?.body??'',
 sections:refs.map(s=>({id:s.id,title:entry.profile==='practical'?(s.id==='s1'?'从一页说明开始':s.id==='s2'?'让工具帮你整理，判断仍留给自己':s.id==='s3'?'别把更多上下文当成更可靠':s.title):`${s.platform} · ${s.kind}要点`,body:distilled[s.id][entry.profile==='practical'?0:1]})),
 next:ai?'挑一个小仓库，写下项目入口、不能改的边界和测试命令。用一个表单改动验证，再检查差异。':'选一个与你当前工作有关的小任务，读完来源后做一次有限的尝试，记录结果与失败。'};}
