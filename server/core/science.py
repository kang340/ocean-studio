"""Read-only helpers for local gridded files (axes detection, metadata, opening NetCDF / GRIB / Zarr)."""
import math, json
from pathlib import Path
import numpy as np
import xarray as xr
from core.variables import canonical
from core.timeutils import parse_utc, normalize_utc, is_gregorian

ALIASES={'longitude':('lon','longitude','nav_lon','xlon','Longitude'), 'latitude':('lat','latitude','nav_lat','ylat','Latitude'), 'time':('time','Time','MT','ocean_time','valid_time'), 'depth':('depth','deptht','lev','level','z','Depth','pressure_level')}

def axes(ds):
    result={}
    for kind,names in ALIASES.items():
        axis={'longitude':'X','latitude':'Y','time':'T','depth':'Z'}[kind]
        candidates=[n for n,v in ds.variables.items() if v.attrs.get('standard_name')==kind]
        candidates += [n for n,v in ds.variables.items() if (kind=='longitude' and 'degrees_east' in v.attrs.get('units','')) or (kind=='latitude' and 'degrees_north' in v.attrs.get('units',''))]
        candidates += [n for n in names if n in ds.variables]
        candidates += [n for n,v in ds.variables.items() if v.attrs.get('axis')==axis and (kind not in ('latitude','longitude') or 'degree' in v.attrs.get('units',''))]
        if candidates:result[kind]=candidates[0]
    return result


def plain(v):
    if isinstance(v,np.generic):return plain(v.item())
    if isinstance(v,np.ndarray):return [plain(x) for x in v.tolist()]
    if isinstance(v,float) and not math.isfinite(v):return None
    if isinstance(v,(str,int,float,bool)) or v is None:return v
    if isinstance(v,dict):return {k:plain(x) for k,x in v.items()}
    if isinstance(v,(list,tuple)):return [plain(x) for x in v]
    return str(v)


def metadata(ds,provider='custom'):
    ax=axes(ds); coords={}
    for kind,name in ax.items():
        v=ds[name];item={'name':name,'size':v.size,'dims':list(v.dims),'attrs':plain(v.attrs)}
        if v.ndim==1 and v.size:
            a=v.values
            item.update(first=str(a[0]),last=str(a[-1]))
            if np.issubdtype(a.dtype,np.number):item.update(min=plain(np.nanmin(a)),max=plain(np.nanmax(a)))
            if v.size<=200:item['values']=plain(a)
        coords[kind]=item
    return {'dimensions':dict(ds.sizes),'coordinates':coords,'variables':[{'name':n,'canonical':canonical(provider,n),'dims':list(v.dims),'shape':list(v.shape),'dtype':str(v.dtype),'units':v.attrs.get('units',''),'long_name':v.attrs.get('long_name',n),'standard_name':v.attrs.get('standard_name',''),'attrs':plain(v.attrs),'encoding':plain({k:v.encoding[k] for k in ['scale_factor','add_offset','_FillValue','missing_value','calendar'] if k in v.encoding})} for n,v in ds.data_vars.items()], 'attrs':plain(ds.attrs),'estimated_uncompressed_bytes':int(ds.nbytes)}


def open_local(path):
    p=Path(path)
    if p.is_dir():return xr.open_zarr(p,consolidated=None)
    with p.open('rb') as f:magic=f.read(8)
    if magic.startswith(b'GRIB'):
        import cfgrib
        datasets=cfgrib.open_datasets(str(p),backend_kwargs={'indexpath':''})
        if not datasets:raise ValueError('No GRIB messages')
        return xr.merge(datasets,compat='override',join='outer')
    return xr.open_dataset(p,engine='netcdf4',mask_and_scale=True)
