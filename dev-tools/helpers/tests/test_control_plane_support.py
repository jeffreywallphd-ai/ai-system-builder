"""Actual completed-work lineage supports implementation, never parent qualification."""
import copy
import json
from test_control_plane_delivery import Fixture
from control_plane.common import digest
from control_plane.projection import project

class SupportingTests(Fixture):
    def setUp(self):
        super().setUp()
        self.repository()
        receipt=self.verify()
        review=self.review(receipt)
        self.work.complete('fixture-work','author-run',self.claim)
        self.link={'roadmap_id':'owner','increment_id':'slice','criterion_id':'parent-check','work_id':'fixture-work','work_criteria':['result'],'receipt_digest':receipt['receipt_digest'],'review_digest':review['review_digest'],'scope':'Reviewed local component','limitations':['Native and current parent qualification remain pending.']}
        self.config={'schema_version':'roadmap-supporting-work-v1','agent_only_roadmaps':['owner'],'criterion_labels':[{'roadmap_id':'owner','increment_id':'slice','criterion_id':'parent-check','title':'Automated technical acceptance'}],'successors':[],'links':[self.link]}
        self.state={'schemaVersion':1,'slug':'owner','name':'Owner','objective':'Technical delivery','status':'blocked','createdAt':'2026-10-21T10:00:00Z','evidencePolicy':'control-plane-v1','currentIncrementId':None,'increments':[{'id':'slice','number':1,'title':'Slice','objective':'Deliver technical outcome','status':'pending','acceptanceCriteria':[{'id':'parent-check','description':'Technical boundary','qualification':'local'}],'plan':{'chunks':[{'id':'chunk','title':'Chunk','outcome':'Technical work','criteriaIds':['parent-check']}]},'completedChunks':[]}],'evidence':[]}
        self.put('.implementation-roadmaps/owner/state.json',json.dumps(self.state))
        self.save_config()
    def save_config(self): self.put('docs/operations/roadmap-supporting-work.json',json.dumps(self.config))
    def criterion(self,data): return data['roadmaps'][0]['increments'][0]['criteria'][0]
    def test_actual_historical_review_is_separate_from_unqualified_parent(self):
        data=project(self.root);c=self.criterion(data)
        self.assertEqual(c['supporting_work'][0]['status'],'reviewed-local-snapshot')
        self.assertEqual(c['supporting_work'][0]['current_qualification'],'not-asserted')
        self.assertEqual(c['outcome'],'missing')
        self.assertEqual(c['title'],'Automated technical acceptance')
        self.assertEqual(data['roadmaps'][0]['increments'][0]['chunks'][0]['status'],'planned')
        self.assertEqual(data['work_items'][0].get('status') in ['complete','planned'],True)
        # The mapping itself changes source after the receipt: no currentness inferred.
        self.put('docs/result.md','changed after recorded review')
        self.assertEqual(self.criterion(project(self.root))['supporting_work'][0]['status'],'reviewed-local-snapshot')
        self.assertEqual(json.loads((self.root/'.implementation-roadmaps/owner/state.json').read_text()),self.state)
    def test_unknown_forged_and_noncompleted_work_never_qualify_support(self):
        baseline=self.work.records.load()
        for mutation in ['missing','active','receipt','self-review','coverage','failed']:
            def alter(state):
                state['work_items']=copy.deepcopy(baseline['work_items'])
                w=state['work_items']['fixture-work']
                if mutation=='missing': state['work_items'].clear();return
                if mutation=='active': w['status']='active'
                if mutation=='receipt': w['receipts'][-1]['source_stable']=False
                if mutation=='failed': w['receipts'][-1]['qualification']='failed'
                if mutation in ['self-review','coverage']:
                    review=w['reviews'][-1]
                    if mutation=='self-review': review['invocation_id']='author-run'
                    else: review['reviewed_criteria']=[]
                    review['review_digest']=digest({k:v for k,v in review.items() if k!='review_digest'})
                    w['completion']['review_digest']=review['review_digest'];self.link['review_digest']=review['review_digest']
            self.work.records.mutate(alter);self.save_config()
            c=self.criterion(project(self.root))
            self.assertNotEqual(c['supporting_work'][0]['status'],'reviewed-local-snapshot',mutation)
            self.assertEqual(c['outcome'],'missing')
            self.link['review_digest']=baseline['work_items']['fixture-work']['completion']['review_digest']
    def test_malformed_configuration_denies_decoration_without_changing_roadmaps(self):
        original=copy.deepcopy(self.config)
        for patch in ['unknown-target','duplicate','extra-path','bad-digest','empty-criteria']:
            self.config=copy.deepcopy(original)
            if patch=='unknown-target':self.config['links'][0]['criterion_id']='unknown'
            if patch=='duplicate':self.config['links'].append(self.config['links'][0])
            if patch=='extra-path':self.config['links'][0]['path']='../private'
            if patch=='bad-digest':self.config['links'][0]['receipt_digest']='forged'
            if patch=='empty-criteria':self.config['links'][0]['work_criteria']=[]
            self.save_config();data=project(self.root)
            self.assertNotIn('supporting_work',self.criterion(data))
            self.assertIn({'code':'projection.supporting-work-unavailable'},data['diagnostics'])
