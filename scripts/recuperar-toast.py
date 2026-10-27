# Recupera versões antigas de uma linha jsonb do Postgres a partir de imagens de página
# (pg_walinspect, block_fpi_data) da tabela TOAST. Usado no incidente de 27/10/2026
# (docs/INCIDENTE-2026-10-27.md). Uso: python3 -I recuperar-toast.py paginas.json pasta_saida
import json, struct, sys, collections

def pages(path):
    for r in json.load(open(path)):
        yield r['bloco'], bytes.fromhex(r['hex'])

def toast_tuples(blk, page):
    pd_lower = struct.unpack_from('<H', page, 12)[0]
    n = (pd_lower - 24) // 4
    for i in range(n):
        lp = struct.unpack_from('<I', page, 24 + 4 * i)[0]
        off = lp & 0x7FFF; flags = (lp >> 15) & 3; ln = lp >> 17
        if flags != 1 or ln == 0: continue
        t = page[off:off + ln]
        xmin, xmax = struct.unpack_from('<II', t, 0)
        infomask = struct.unpack_from('<H', t, 20)[0]
        hoff = t[22]
        d = t[hoff:]
        chunk_id, chunk_seq = struct.unpack_from('<Ii', d, 0)
        v = d[8:]
        b0 = v[0]
        if b0 & 1:  # 1-byte header
            size = b0 >> 1; data = v[1:size]
        else:
            hdr = struct.unpack_from('<I', v, 0)[0]
            size = hdr >> 2; data = v[4:size]
        yield dict(blk=blk, lp=i + 1, xmin=xmin, xmax=xmax, infomask=infomask, chunk_id=chunk_id, seq=chunk_seq, data=data)

def pglz_decompress(src, rawsize):
    out = bytearray(); sp = 0
    while sp < len(src) and len(out) < rawsize:
        ctrl = src[sp]; sp += 1
        for bit in range(8):
            if sp >= len(src) or len(out) >= rawsize: break
            if ctrl & 1:
                b0, b1 = src[sp], src[sp + 1]
                ln = (b0 & 0x0f) + 3; off = ((b0 & 0xf0) << 4) | b1; sp += 2
                if ln == 18: ln += src[sp]; sp += 1
                for _ in range(ln): out.append(out[-off])
            else:
                out.append(src[sp]); sp += 1
            ctrl >>= 1
    return bytes(out)

JB_CMASK = 0x0FFFFFFF; JB_FSCALAR = 0x10000000; JB_FOBJECT = 0x20000000; JB_FARRAY = 0x40000000
JENTRY_OFFLENMASK = 0x0FFFFFFF; JENTRY_TYPEMASK = 0x70000000; JENTRY_HAS_OFF = 0x80000000

def numeric(b):
    if b[0] & 1:  # short varlena header
        size = b[0] >> 1; body = b[1:size]
    else:
        size = struct.unpack_from('<I', b, 0)[0] >> 2; body = b[4:size]
    h = struct.unpack_from('<H', body, 0)[0]
    if (h & 0xC000) == 0x8000:  # short
        neg = bool(h & 0x2000); dscale = (h >> 7) & 0x3F
        w = h & 0x3F
        if h & 0x40: w = w - 64
        digits = struct.unpack_from('<%dh' % ((len(body) - 2) // 2), body, 2)
    elif (h & 0xC000) == 0xC000:
        return None
    else:
        neg = (h & 0xC000) == 0x4000; dscale = h & 0x3FFF
        w = struct.unpack_from('<h', body, 2)[0]
        digits = struct.unpack_from('<%dh' % ((len(body) - 4) // 2), body, 4)
    val = 0
    from decimal import Decimal
    val = Decimal(0)
    for i, dg in enumerate(digits):
        val += Decimal(dg) * (Decimal(10000) ** (w - i))
    if neg: val = -val
    if dscale == 0: return int(val)
    return float(round(val, dscale))

def container(buf, base):
    header = struct.unpack_from('<I', buf, base)[0]
    count = header & JB_CMASK
    is_obj = bool(header & JB_FOBJECT); is_scalar = bool(header & JB_FSCALAR)
    nent = count * 2 if is_obj else count
    jes = struct.unpack_from('<%dI' % nent, buf, base + 4)
    data = base + 4 + 4 * nent
    def offset(i):
        o = 0
        for j in range(i - 1, -1, -1):
            o += jes[j] & JENTRY_OFFLENMASK
            if jes[j] & JENTRY_HAS_OFF: break
        return o
    def length(i):
        if jes[i] & JENTRY_HAS_OFF: return (jes[i] & JENTRY_OFFLENMASK) - offset(i)
        return jes[i] & JENTRY_OFFLENMASK
    def value(i):
        t = jes[i] & JENTRY_TYPEMASK; o = offset(i); ln = length(i)
        if t == 0x00000000: return buf[data + o:data + o + ln].decode('utf-8')
        if t == 0x10000000:
            a = (o + 3) & ~3
            return numeric(buf[data + a:data + o + ln])
        if t == 0x20000000: return False
        if t == 0x30000000: return True
        if t == 0x40000000: return None
        if t == 0x50000000:
            a = (o + 3) & ~3
            return container(buf, data + a)
        raise ValueError(hex(t))
    if is_obj:
        return {value(i): value(i + count) for i in range(count)}
    arr = [value(i) for i in range(count)]
    return arr[0] if is_scalar else arr

def main(path, outdir):
    allt = []
    for blk, page in pages(path):
        allt.extend(toast_tuples(blk, page))
    by = collections.defaultdict(list)
    for t in allt: by[t['chunk_id']].append(t)
    results = []
    for cid, ts in by.items():
        ts.sort(key=lambda t: t['seq'])
        seqs = [t['seq'] for t in ts]
        complete = seqs == list(range(len(seqs)))
        raw = b''.join(t['data'] for t in ts)
        info = dict(chunk_id=cid, chunks=len(ts), seqs=seqs, complete=complete, bytes=len(raw),
                    xmin=min(t['xmin'] for t in ts), xmax=max(t['xmax'] for t in ts), blocks=sorted({t['blk'] for t in ts}))
        try:
            tcinfo = struct.unpack_from('<I', raw, 0)[0]
            rawsize = tcinfo & 0x3FFFFFFF; method = tcinfo >> 30
            info['rawsize'] = rawsize; info['method'] = method
            dec = pglz_decompress(raw[4:], rawsize)
            info['decompressed'] = len(dec)
            doc = container(dec, 0)
            info['ok'] = True
            fn = f"{outdir}/versao_{cid}.json"
            json.dump(doc, open(fn, 'w'), ensure_ascii=False)
            info['file'] = fn
            if isinstance(doc, dict):
                info['resumo'] = {k: (len(doc[k]) if isinstance(doc.get(k), list) else doc.get(k)) for k in ['absences','extraShifts','shiftChanges','weekOverrides','dayOverrides','history','tasks','dentistAbsences','closedDates','historySince']}
        except Exception as e:
            info['ok'] = False; info['erro'] = repr(e)
        results.append(info)
    results.sort(key=lambda r: r['xmin'])
    for r in results: print(json.dumps(r, ensure_ascii=False))

main(sys.argv[1], sys.argv[2])
