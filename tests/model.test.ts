import {describe,it,expect} from 'vitest';
import {initialState,collect,generate,sources,story} from '../src/model';
describe('deterministic demo provenance',()=>{
 it('generates from the selected run and keeps its style snapshot',()=>{let s=initialState();s.topics[0].profile='brief';s=collect(s,'t1','success');const r=s.runs[0];s.topics[0].profile='practical';s=generate(s,r.id);expect(s.entries[0].profile).toBe('brief');expect(s.entries[0].sourceIds).toEqual(r.sourceIds);expect(s.entries[0].runId).toBe(r.id);expect(story(s.entries[0]).title).toContain('仍需');});
 it('does not generate on failure or empty results',()=>{for(const status of ['failed','empty'] as const){const s=collect(initialState(),'t1',status);expect(s.runs[0].sourceIds).toEqual([]);expect(generate(s,s.runs[0].id).entries).toEqual(s.entries)}});
 it('honors platform scope and excludes unavailable source from partial output',()=>{const s=collect(initialState(),'t1','partial');expect(s.runs[0].sourceIds).toEqual(['s1','s2']);expect(s.runs[0].status).toBe('partial')});
 it('returns no results for an unsupported custom topic',()=>{const s=initialState();s.topics[0].name='unknown';s.topics[0].id='custom';expect(collect(s,'custom','success').runs[0].status).toBe('empty')});
 it('preserves resolvable references and deterministic reset',()=>{const s=generate(collect(initialState(),'t1','success'),'r1');expect(s.entries[0].sourceIds.every(id=>sources.some(x=>x.id===id))).toBe(true);expect(initialState()).toEqual(initialState())});
});
