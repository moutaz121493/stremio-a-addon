const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 10000;
const REAL_DEBRID_API_KEY = process.env.RD_API_KEY;

// ذاكرة مؤقتة لحفظ أسماء الأفلام وربطها بالمعرفات
const metaCache = new Map();

// تم تغيير ID الإضافة لكسر الكاش القديم في Stremio وإجباره على التحديث
const manifest = {
    id: 'org.stremio.adult.debrid.v5',
    version: '1.5.0',
    name: 'Adult Studios Ultimate RD',
    description: 'يجلب آلاف الأفلام الحقيقية للشركات عبر API مع تشغيل مباشر وآمن من Real-Debrid',
    types: ['movie'],
    catalogs: [
        {
            type: 'movie',
            id: 'adult_studios_live',
            name: 'شركات الإنتاج (+18)',
            genres: ['Brazzers', 'Vixen', 'Reality Kings', 'Blacked', 'Tushy', 'Evil Angel', 'Naughty America', 'BangBros']
        }
    ],
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: ['tpb_']
};

app.get('/manifest.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.json(manifest);
});

// 1. مسار جلب الكتالوج (يسحب آلاف الأفلام الحقيقية فوراً)
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    let genre = 'Brazzers';
    if (req.params.extra) {
        const match = req.params.extra.match(/genre=([^&]+)/);
        if (match) genre = decodeURIComponent(match[1]);
    }

    try {
        // الاتصال بمحرك بحث تورنت مفتوح لجلب أحدث إصدارات الشركة
        const tpbRes = await axios.get(`https://apibay.org/q.php?q=${encodeURIComponent(genre)}&cat=500`);
        const torrents = tpbRes.data;

        // التحقق من وجود نتائج حقيقية
        if (!Array.isArray(torrents) || torrents[0].id === '0') {
            return res.json({ metas: [] });
        }

        const metas = torrents.slice(0, 100).map(t => {
            const metaId = `tpb_${t.info_hash}`;
            const sizeGB = (t.size / 1024 / 1024 / 1024).toFixed(2);
            
            // حفظ البيانات في الذاكرة لكي تظهر في صفحة التفاصيل
            metaCache.set(metaId, { name: t.name, hash: t.info_hash });

            return {
                id: metaId,
                type: 'movie',
                name: t.name,
                poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&h=450&fit=crop', // بوستر سينمائي كلاسيكي لتوحيد الشكل
                description: `الشركة: ${genre}\nالحجم: ${sizeGB} GB\nالرافعين: ${t.seeders}`,
                genres: [genre]
            };
        });

        res.json({ metas });
    } catch (e) {
        res.json({ metas: [] });
    }
});

// 2. مسار تفاصيل الفيلم (تم حله ليعرض التفاصيل فوراً)
app.get('/meta/:type/:id.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    const id = req.params.id;
    const cached = metaCache.get(id);

    if (!cached) {
        return res.json({ meta: null });
    }

    res.json({
        meta: {
            id: id,
            type: 'movie',
            name: cached.name,
            poster: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&h=450&fit=crop',
            description: 'شاهد هذا الفيلم الآن بسرعة فائقة وبدون أي تخزين محلي بفضل الاتصال السحابي المشفر عبر Real-Debrid.',
            releaseInfo: 'RD Cloud'
        }
    });
});

// 3. مسار البث وتوليد رابط Real-Debrid المباشر
app.get('/stream/:type/:id.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    const id = req.params.id;
    const hash = id.replace('tpb_', '');

    if (!REAL_DEBRID_API_KEY) {
        return res.json({ streams: [{ title: '⚠️ ضع التوكن في Render', url: '' }] });
    }

    try {
        const rdHeaders = { Authorization: `Bearer ${REAL_DEBRID_API_KEY}` };
        const rdPostHeaders = { ...rdHeaders, 'Content-Type': 'application/x-www-form-urlencoded' };

        // أ- فحص إذا كان الملف مخزناً في السحابة
        const iaRes = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${hash}`, { headers: rdHeaders });
        const ia = iaRes.data;

        if (ia && ia[hash] && ia[hash].rd && ia[hash].rd.length > 0) {
            
            // ب- إذا كان مخزناً، نقوم بإنشاء الرابط المباشر
            const magnet = `magnet:?xt=urn:btih:${hash}`;
            const addRes = await axios.post('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', `magnet=${encodeURIComponent(magnet)}`, { headers: rdPostHeaders });
            const torrentId = addRes.data.id;

            // اختيار ملف الفيديو
            await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, 'files=all', { headers: rdPostHeaders });

            // جلب معلومات الملف
            const infoRes = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, { headers: rdHeaders });
            const links = infoRes.data.links;

            if (links && links.length > 0) {
                // فك التشفير (Unrestrict) للحصول على الرابط المباشر لـ Stremio
                const unrestrictRes = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', `link=${encodeURIComponent(links[0])}`, { headers: rdPostHeaders });
                const streamUrl = unrestrictRes.data.download;

                return res.json({
                    streams: [
                        {
                            title: '🚀 [RD Direct Stream]\nتشغيل فوري - مشفر 100%',
                            url: streamUrl
                        }
                    ]
                });
            }
        }

        res.json({ streams: [{ title: '⚠️ الملف يحتاج تحميل غير متوفر كاش حالياً', url: '' }] });

    } catch (error) {
        console.error(error.message);
        res.json({ streams: [{ title: '❌ خطأ في الاتصال بسيرفر RD', url: '' }] });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
