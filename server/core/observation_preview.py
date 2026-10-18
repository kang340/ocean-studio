"""Time-series previews for observed records, without spatial interpolation."""
import csv, json, math
from itertools import islice
from pathlib import Path
from core.science import open_local, metadata
import numpy as np

def observation_preview(path, request, variable=None):
    opts=request.get('options',{});path=Path(path);station_field=opts.get('station_field') or 'station_id'
    vertical=opts.get('vertical');identity=opts.get('identity') or []
    excluded={'time','longitude','latitude','altitude','depth',station_field,vertical,*identity,'WMO','ID','record_id','platform_type'}
    missing=opts.get('missing_values') or {}
    def valid_value(value,name):
        try:
            number=float(value);return math.isfinite(number) and number not in missing.get(name,[])
        except (ValueError,TypeError):return False
    def quality(name):return 'qc' in name.lower() or (name.startswith('Q') and '_' in name)
    if request['format'] in ('csv','json'):
        if request['format']=='csv':
            with path.open(encoding='utf-8-sig',newline='') as f:
                reader=csv.reader(f);names=next(reader);units=next(reader)
                rows=[dict(zip(names,row)) for row in islice(reader,2000)]
            unit_map=dict(zip(names,units))
        else:
            table=json.loads(path.read_text(encoding='utf-8'))['table'];names=table['columnNames']
            rows=[dict(zip(names,row)) for row in table['rows'][:2000]]
            unit_map=dict(zip(names,table.get('columnUnits',[])))
        def numeric(name):
            for row in rows[:100]:
                try:float(row.get(name));return True
                except (ValueError,TypeError):pass
            return False
        variables=[{'name':name,'units':unit_map.get(name,'')} for name in names if name not in excluded and numeric(name)]
        info={'variables':variables,'dimensions':{'preview_rows':len(rows)},'coordinates':{}}
    else:
        with open_local(path) as ds:
            info=metadata(ds)
            variables=[v for v in info['variables'] if v['name'] not in excluded and np.issubdtype(ds[v['name']].dtype,np.number)]
            info['variables']=variables
            name=variable or next((v['name'] for v in variables if not quality(v['name']) and any(valid_value(x,v['name']) for x in ds[v['name']].values.reshape(-1)[:2000])),None)
            if not name or name not in {v['name'] for v in variables}:raise ValueError('没有可预览的数值观测变量')
            d=ds[name].dims[0]
            sample=ds.isel({d:slice(0,2000)})
            fields=[n for n in [station_field,'time',name,vertical,'longitude','latitude',*identity] if n in sample and sample[n].dims==(d,)]
            values={n:sample[n].values for n in fields}
            rows=[{n:float(values[n][i]) if n in (name,vertical,'longitude','latitude') else str(values[n][i]) for n in fields} for i in range(sample.sizes[d])]
    name=variable or next((v['name'] for v in variables if not quality(v['name']) and any(valid_value(row.get(v['name']),v['name']) for row in rows)),None)
    if not name:name=next((v['name'] for v in variables if not quality(v['name'])),None)
    if not name or name not in {v['name'] for v in variables}:raise ValueError('没有可预览的数值观测变量')
    records=[]
    for row in rows:
        try:value=float(row.get(name))
        except (ValueError,TypeError):continue
        if math.isfinite(value) and value not in missing.get(name,[]):
            record={'station':str(row.get(station_field,'全部观测')),'time':str(row.get('time','')),'value':value}
            try:
                lon,lat=float(row.get('longitude')),float(row.get('latitude'))
                if math.isfinite(lon) and math.isfinite(lat) and -90<=lat<=90:record.update(lon=((lon+180)%360)-180,lat=lat)
            except (TypeError,ValueError):pass
            if vertical:
                try:
                    level=float(row.get(vertical))
                    if math.isfinite(level) and level not in missing.get(vertical,[]):record['level']=level
                except (TypeError,ValueError):pass
                record['profile']=' · '.join([record['station'],record['time'],*[str(row[n]) for n in identity if n in row]])
            records.append(record)
    vals=[r['value'] for r in records]
    info['preview']={'kind':'observations','variable':name,'records':records,'vertical':vertical,'vertical_units':opts.get('vertical_units'), 'sampled':True,'min':min(vals) if vals else None,'max':max(vals) if vals else None,'mean':sum(vals)/len(vals) if vals else None,'slice':{'max_rows':2000}}
    return info
