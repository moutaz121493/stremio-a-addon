const express = require('express');
const axios = require('axios');
const app = express();

const PORT = process.env.PORT || 7000;

// مفتاح Real-Debrid الخاص بك
const REAL_DEBRID_API_KEY = process.env.RD_API_KEY || 'YOUR_REAL_DEBRID_API_KEY';

// تعريف الـ Manifest الخاص بالإضافة (مخصص وحصري للفئات المطلوبة)
const manifest = {
    id: 'org.stremio.adult.debrid.studios',
    version: '1.0.0',
    name: 'Adult Studios Debrid Addon',
    description: 'إضافة مخصصة لمحتوى الكبار (+18) منظمة حسب شركات الإنتاج مع التحقق الفوري من Real-Debrid',
    types: ['movie'],
    catalogs: [
        {
            type: 'movie',
            id: 'adult_studios',
            name: 'شركات الإنتاج الكبرى (+18)',
            genres: ['Brazzers', 'Vixen', 'Reality Kings', 'Blacked', 'Tushy', 'Evil Angel']
        }
    ],
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: ['studio_adult_']
};

// 1. مسار الـ Manifest
app.get('/manifest.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.json(manifest);
});

// 2. مسار جلب القوائم حسب الشركة المنتجة
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    const genre = req.params.extra ? new URLSearchParams(req.params.extra).get('genre') : 'Brazzers';

    // قائمة عينة للأفلام المنظمة حسب الشركة (يمكن ربطها بقاعدة بيانات حقيقية أو StashDB/TPDB)
    const items = [
        {
            id: 'studio_adult_001',
            type: 'movie',
            name: `[${genre || 'Studio'}] Exclusive Scene 2026 - Vol. 1`,
            poster: 'https://via.placeholder.com/300x450.png?text=' + encodeURIComponent(genre || 'Adult'),
            description: 'محتوى حصري منظم حسب الشركة المنتجة ومتاح عبر سحابة Real-Debrid.',
            genres: [genre || 'Studio']
        }
    ];

    res.json({ metas: items });
});

// 3. مسار التفاصيل (Meta)
app.get('/meta/:type/:id.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    const { id } = req.params;

    res.json({
        meta: {
            id: id,
            type: 'movie',
            name: 'تفاصيل العرض الحصري',
            poster: 'https://via.placeholder.com/300x450.png?text=Adult+Content',
            description: 'يعمل هذا العرض حصرياً عبر سيرفرات Debrid المشفرة بدون حفظ أي ملفات محلية.',
            releaseInfo: '2026'
        }
    });
});

// 4. مسار جلب الروابط والتحقق الفوري من Real-Debrid
app.get('/stream/:type/:id.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    const { id } = req.params;

    try {
        // الـ Hash الخاص بالتورنت المرتبط بهذا الفيديو (يتم جلبه من قاعدة بياناتك الخاصة بالروابط)
        const sampleTorrentHash = "YOUR_TARGET_TORRENT_HASH_HERE"; 

        // فحص الـ Cache الفوري لدى Real-Debrid
        const checkResponse = await axios.get(
            `https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${sampleTorrentHash}`,
            {
                headers: { Authorization: `Bearer ${REAL_DEBRID_API_KEY}` }
            }
        );

        const data = checkResponse.data;
        let streams = [];

        // التحقق من توفر الملف في السحابة
        if (data && data[sampleTorrentHash] && data[sampleTorrentHash].rd && data[sampleTorrentHash].rd.length > 0) {
            streams.push({
                title: '🔥 [Real-Debrid Cached] - تشغيل فوري وآمن 100% (4K/1080p)',
                url: 'https://pro.real-debrid.com/streaming-link-generated-example' // الرابط المباشر الآمن من سحابة RD
            });
        } else {
            streams.push({
                title: '⚠️ الملف غير مخزن حالياً في سيرفرات السحابة',
                url: ''
            });
        }

        res.json({ streams });

    } catch (error) {
        console.error('Real-Debrid API Error:', error.message);
        res.json({ streams: [{ title: 'خطأ في الاتصال بخدمة الحماية والسيرفر', url: '' }] });
    }
});

app.listen(PORT, () => {
    console.log(`Adult Debrid Addon running on http://localhost:${PORT}`);
});
