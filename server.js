const express = require('express');
const axios = require('axios');
const cors = require('cors'); // مكتبة حماية الاتصالات
const app = express();

app.use(cors()); // تفعيل الـ CORS لتطبيق Stremio

const PORT = process.env.PORT || 10000;
const REAL_DEBRID_API_KEY = process.env.RD_API_KEY;

// دوال تشفير آمنة جداً للمسارات (لمنع أخطاء 404 في Stremio)
function toSafeBase64(str) {
    return Buffer.from(str, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromSafeBase64(str) {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return Buffer.from(b64, 'base64').toString('utf-8');
}

const manifest = {
    id: 'org.stremio.adult.debrid.pro',
    version: '3.0.0', // تم رفع النسخة لكسر الكاش الإجباري
    name: 'Adult Studios PRO (RD)',
    description: 'الإصدار الاحترافي: جلب آلاف الأفلام الحقيقية مع تشغيل سحابي فوري ومشفر من Real-Debrid',
    types: ['movie'],
    catalogs: [
        {
            type: 'movie',
            id: 'adult_studios_pro',
            name: 'شركات الإنتاج (+18)',
            genres: ['Brazzers', 'Vixen', 'Reality Kings', 'Blacked', 'Tushy', 'Evil Angel', 'Naughty America', 'BangBros', 'Jules Jordan']
        }
    ],
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: ['abd_']
};

// 1. مسار تعريف الإضافة
app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

// 2. مسار جلب القوائم (يسحب الأفلام الحقيقية)
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    let genre = 'Brazzers';
    if (req.params.extra) {
        const match = req.params.extra.match(/genre=([^&]+)/);
        if (match) genre = decodeURIComponent(match[1]);
    }

    try {
        const axiosConfig = { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 };
        const tpbRes = await axios.get(`https://apibay.org/q.php?q=${encodeURIComponent(genre)}&cat=500`, axiosConfig);
        const torrents = tpbRes.data;

        if (!Array.isArray(torrents) || torrents[0].id === '0') {
            return res.json({ metas: [] });
        }

        const metas = torrents.slice(0, 100).filter(t => t.info_hash).map(t => {
            // تنظيف الاسم وتشفيره بصيغة آمنة للمسارات
            const cleanName = t.name.substring(0, 80).replace(/\|/g, ''); 
            const dataString = `${genre}|${t.info_hash}|${encodeURIComponent(cleanName)}`;
            const safeId = 'abd_' + toSafeBase64(dataString);
            const sizeGB = (t.size / 1073741824).toFixed(2);

            return {
                id: safeId,
                type: 'movie',
                name: t.name,
                poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&h=450&fit=crop',
                description: `🎬 الشركة: ${genre}\n📦 الحجم: ${sizeGB} GB\n🚀 السيدرز: ${t.seeders}\n\nيتم التشغيل بأمان وتشفير عبر سحابة Real-Debrid.`,
                genres: [genre]
            };
        });
        res.json({ metas });
    } catch (e) {
        console.error('Catalog Error:', e.message);
        res.json({ metas: [] });
    }
});

// 3. مسار تفاصيل الفيلم (يفك التشفير الآمن)
app.get('/meta/:type/:id.json', (req, res) => {
    const id = req.params.id;
    try {
        const b64 = id.replace('abd_', '');
        const decoded = fromSafeBase64(b64);
        const [genre, hash, encodedName] = decoded.split('|');
        const name = decodeURIComponent(encodedName);

        res.json({
            meta: {
                id: id,
                type: 'movie',
                name: name,
                poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&h=450&fit=crop',
                description: `إنتاج شركة: ${genre} - جودة فائقة وحماية سحابية.`,
                releaseInfo: 'Real-Debrid Cloud'
            }
        });
    } catch (e) {
        res.json({ meta: null });
    }
});

// 4. مسار جلب روابط المشاهدة الآمنة من Real-Debrid
app.get('/stream/:type/:id.json', async (req, res) => {
    const id = req.params.id;

    if (!REAL_DEBRID_API_KEY) {
        return res.json({ streams: [{ title: '⚠️ مفتاح Debrid مفقود في إعدادات Render', url: '' }] });
    }

    try {
        const b64 = id.replace('abd_', '');
        const decoded = fromSafeBase64(b64);
        const hash = decoded.split('|')[1];

        const rdHeaders = { Authorization: `Bearer ${REAL_DEBRID_API_KEY}` };
        const rdPostHeaders = { ...rdHeaders, 'Content-Type': 'application/x-www-form-urlencoded' };

        // أ- فحص ما إذا كان الملف متوفراً في السحابة فورياً
        const iaRes = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${hash}`, { headers: rdHeaders });
        const ia = iaRes.data;

        if (ia && ia[hash] && ia[hash].rd && ia[hash].rd.length > 0) {
            
            // اختيار الملفات المخزنة بالفعل فقط (لضمان التشغيل الفوري 100%)
            const cachedVariant = ia[hash].rd[0];
            const fileIds = Object.keys(cachedVariant).join(',');

            // ب- إضافة الـ Magnet
            const magnet = `magnet:?xt=urn:btih:${hash}`;
            const addRes = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', `magnet=${encodeURIComponent(magnet)}`, { headers: rdPostHeaders });
            const torrentId = addRes.data.id;

            // ج- اختيار الملفات المحددة
            await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, `files=${fileIds}`, { headers: rdPostHeaders });

            // د- جلب الرابط السحابي
            const infoRes = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, { headers: rdHeaders });
            const links = infoRes.data.links;

            if (links && links.length > 0) {
                // هـ- فك التشفير للحصول على رابط التشغيل المباشر
                const unrestrictRes = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', `link=${encodeURIComponent(links[0])}`, { headers: rdPostHeaders });
                
                return res.json({
                    streams: [{
                        title: '🚀 [RD Direct] - 4K/1080p\nتشغيل سحابي فوري ومشفر',
                        url: unrestrictRes.data.download
                    }]
                });
            }
        }

        // إذا لم يكن مخزناً في الكاش
        res.json({ streams: [{ title: '⚠️ الملف يحتاج للتحميل (غير مخزن سحابياً حالياً)', url: '' }] });

    } catch (error) {
        console.error('Stream Error:', error.message);
        res.json({ streams: [{ title: '❌ خطأ في الاتصال بسيرفر Real-Debrid', url: '' }] });
    }
});

app.listen(PORT, () => {
    console.log(`PRO Server running on port ${PORT}`);
});
