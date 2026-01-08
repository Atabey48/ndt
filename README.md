# ndt
# NDT Document Hub

Üretici bazlı PDF doküman yönetimi, section + figure çıkarımı, audit log ve tool/search modülü sunan FastAPI + statik UI uygulaması.

## Hızlı Başlangıç

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Ardından `http://localhost:8000/app` adresini açın.

### Varsayılan kullanıcılar

- Admin: `admin` / `admin123`
- Kullanıcı: `user` / `user123`

## Yapı

- `server/app`: FastAPI backend, PDF parsing, audit log, arama
- `web`: Statik UI (üretici seçimi, doküman listesi, tool/search)
- `server/storage`: PDF dosyaları (lokal mock object storage)
- `server/data`: SQLite veritabanı