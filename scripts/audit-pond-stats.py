import argparse, collections, datetime as dt, json, subprocess, urllib.request, urllib.parse
parser=argparse.ArgumentParser(description="Read-only audit of Pond stats. Prints aggregates only; never writes raw debate content.")
parser.add_argument("--project", required=True)
parser.add_argument("--output", help="Optional path for aggregate JSON evidence")
args=parser.parse_args()
now=dt.datetime.now(dt.timezone.utc)
token=subprocess.check_output(['gcloud','auth','print-access-token'],text=True).strip()
base='https://firestore.googleapis.com/v1/projects/'+urllib.parse.quote(args.project,safe='')+'/databases/(default)/documents/'
def documents(collection):
    rows=[]; page=None
    while True:
        params={'pageSize':'100'}
        if page: params['pageToken']=page
        request=urllib.request.Request(base+collection+'?'+urllib.parse.urlencode(params),headers={'Authorization':'Bearer '+token})
        with urllib.request.urlopen(request,timeout=30) as response: payload=json.load(response)
        rows.extend(payload.get('documents',[])); page=payload.get('nextPageToken')
        if not page: return rows
def date(value):
    try: return dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    except (ValueError,AttributeError,TypeError): return None
rows=documents('debate_records'); records=[]; missing=0
for doc in rows:
    value=doc.get('fields',{}).get('recordJson',{}).get('stringValue')
    if value: records.append(json.loads(value))
    else: missing+=1
statuses=collections.Counter(r.get('status') for r in records)
terminal={'complete','failed','partial'}
active=[r for r in records if r.get('status') not in terminal]
invalid_dates=sum(date(r.get('createdAt')) is None or date(r.get('updatedAt')) is None for r in records)
future=sum(bool(date(r.get('createdAt')) and date(r['createdAt'])>now) for r in records)
latest_mismatch=collections.Counter((r.get('status'),r['latestRun'].get('status')) for r in records if r.get('latestRun') and r.get('status')!=r['latestRun'].get('status'))
feedback=documents('user_feedback')
result={'checkedAt':now.isoformat(),'documentCount':len(rows),'parsedCount':len(records),'missingRecordJson':missing,'duplicateIds':len(records)-len({r.get('id') for r in records}),'invalidDates':invalid_dates,'futureCreatedDates':future,'statusCounts':dict(statuses),'completionPercent':round(statuses['complete']/len(records)*100) if records else 0,'missingUpdatedAtField':sum('updatedAt' not in d.get('fields',{}) for d in rows),'completeWithoutRun':sum(r.get('status')=='complete' and not r.get('latestRun') for r in records),'statusRunMismatch':[{'recordStatus':k[0],'runStatus':k[1],'count':v} for k,v in latest_mismatch.items()],'unfinished':[{'status':r.get('status'),'createdAt':r.get('createdAt'),'updatedAt':r.get('updatedAt'),'minutesSinceUpdate':round((now-date(r['updatedAt'])).total_seconds()/60,1),'hasRetryState':bool(r.get('retryState'))} for r in active],'feedbackCount':len(feedback),'feedbackApps':dict(collections.Counter(d.get('fields',{}).get('app',{}).get('stringValue') for d in feedback))}
models=collections.Counter(); sources=turns=prompt=completion=followups=0
for r in records:
    run=r.get('latestRun') or {}; sources+=len(run.get('sources',[])); turns+=len(run.get('turns',[])); followups+=len(r.get('followups',[]))
    snaps=run.get('modelSnapshots',[]); models.update({s.get('model') for s in snaps})
    prompt+=sum(s.get('promptTokens',0) or 0 for s in snaps); completion+=sum(s.get('completionTokens',0) or 0 for s in snaps)
result['lastUpdatedAt']=max((r.get('updatedAt','') for r in records),default=None)
result.update(totalSources=sources,totalTurns=turns,totalFollowups=followups,promptTokens=prompt,completionTokens=completion,modelUsage=dict(models))
for n in [7,30]:
    start=(now-dt.timedelta(days=n-1)).replace(hour=0,minute=0,second=0,microsecond=0)
    result['recent'+str(n)+'Days']=sum(bool(date(r.get('createdAt')) and start<=date(r['createdAt'])<=now) for r in records)
result['dailyActivity']={str((now-dt.timedelta(days=i)).date()):sum(bool(date(r.get('createdAt')) and date(r['createdAt']).date()==(now-dt.timedelta(days=i)).date()) for r in records) for i in range(13,-1,-1)}
print(json.dumps(result,indent=2))
if args.output:
    with open(args.output,'w') as f: json.dump(result,f,indent=2)
