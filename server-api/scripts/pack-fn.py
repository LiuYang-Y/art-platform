#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 meiyu-api 函数包打成 zip，供 scripts/deploy-fn-code.js 上传。
------------------------------------------------------------
用法：python scripts/pack-fn.py [srcDir] [outZip]
默认：srcDir = deploy/cloudfunctions/meiyu-api
      outZip = <repoRoot>/../output/meiyu-api.zip

必须在 Linux 容器里解压后可用，因此：
  * create_system=3（Unix），否则解压端不套用 unix 权限位；
  * scf_bootstrap 必须 0755（SCF Web 函数要求可执行）；其余 0644；
  * **必须保留空目录条目**——例如 uploads/。仅写文件条目会丢空目录，
    容器内路径不存在时业务代码 mkdir 会失败（只读盘 → 函数 443 不可用）；
  * 条目名用 forward slash。
"""
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, "deploy", "cloudfunctions", "meiyu-api"
)
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    os.path.dirname(ROOT), "output", "meiyu-api.zip"
)

if not os.path.isdir(SRC):
    sys.exit("未找到函数包目录: %s" % SRC)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
if os.path.exists(OUT):
    os.remove(OUT)


def _info(name, mode):
    zi = zipfile.ZipInfo(name)
    zi.create_system = 3
    zi.external_attr = (mode & 0xFFFF) << 16
    zi.compress_type = zipfile.ZIP_DEFLATED
    return zi


files = 0
raw = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, dirs, fs in os.walk(SRC):
        for d in dirs:
            rel = os.path.relpath(os.path.join(root, d), SRC).replace(os.sep, "/") + "/"
            di = _info(rel, 0o40755)
            di.external_attr |= 0x10  # MS-DOS 目录位
            z.writestr(di, b"")
        for f in fs:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, SRC).replace(os.sep, "/")
            mode = 0o755 if rel == "scf_bootstrap" else 0o644
            with open(full, "rb") as fh:
                z.writestr(_info(rel, mode), fh.read())
            files += 1
            raw += os.path.getsize(full)

size = os.path.getsize(OUT)
print("files=%d raw=%.2fMB zip=%.2fMB -> %s" % (files, raw / 1048576, size / 1048576, OUT))
with zipfile.ZipFile(OUT) as z:
    for name in ("index.js", "scf_bootstrap", "package.json"):
        try:
            info = z.getinfo(name)
            print("  %s: mode=%s create_system=%s" % (name, oct(info.external_attr >> 16), info.create_system))
        except KeyError:
            print("  %s: MISSING!" % name)
print("下一步：node scripts/deploy-fn-code.js")
