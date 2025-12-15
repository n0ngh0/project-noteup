const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const pdf = require('pdf2pic');

const pool = require('../config/database');

const router = express.Router();

router.get('/subjects', async (req, res) => {
    try {
        const sql = `
            SELECT subject_id, subject_code, subject_name 
            FROM subjects 
            ORDER BY subject_code ASC
        `;
        const [rows] = await pool.query(sql);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching subjects" });
    }
});

router.get('/', async (req, res) => {
    try {
        const currentUserId = req.query.userId || 0;
        const searchRaw = req.query.search || '';
        const hasSearch = searchRaw.trim() !== '';
        const searchTerm = hasSearch ? `%${searchRaw.trim()}%` : null;

        const params = [currentUserId];
        const whereClauses = [];

        if (hasSearch) {
            whereClauses.push(`
                (n.title LIKE ? OR s.subject_name LIKE ? OR EXISTS (
                    SELECT 1 FROM note_tags nt
                    JOIN tags t ON nt.tag_id = t.tag_id
                    WHERE nt.note_id = n.note_id AND t.tag_name LIKE ?
                ))
            `);
            params.push(searchTerm, searchTerm, searchTerm);
        }

        const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const [rows] = await pool.query(`
            SELECT
                n.note_id AS id,
                n.title AS note_title,
                n.thumbnail_url AS file_img,
                u.file_img as profile,u.nickname,
                n.views,
                s.subject_code AS note_code,
                s.subject_name,
                u.username AS uploader,
                (SELECT COUNT(*) FROM likes WHERE note_id = n.note_id AND user_id = ?) AS is_liked,
                (SELECT COUNT(*) FROM likes WHERE note_id = n.note_id) AS total_likes,
                COUNT(DISTINCT c.comment_id) AS comment_count,
                GROUP_CONCAT(DISTINCT t.tag_name) AS tags
            FROM notes AS n
            JOIN subjects AS s ON n.subject_id = s.subject_id
            JOIN users AS u ON n.uploader_id = u.user_id
            LEFT JOIN comments AS c ON n.note_id = c.note_id
            LEFT JOIN note_tags nt ON n.note_id = nt.note_id
            LEFT JOIN tags t ON nt.tag_id = t.tag_id
            ${whereSql}
            GROUP BY n.note_id, n.title, n.file_url, n.views, s.subject_code, s.subject_name, u.username
            ORDER BY n.created_at DESC;
        `, params);

        // --- แปลง tags จาก comma-separated string → array ---
        rows.forEach(row => {
            if (row.tags == null) {
                row.tags = [];
            } else if (typeof row.tags === 'string') {
                row.tags = row.tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
            } else if (!Array.isArray(row.tags)) {
                row.tags = [];
            }
        });

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Something went wrong" });
    }
});

// =======================================================
// 1. Tab: โน้ตที่อัปโหลด (Uploads)
// Path: /api/notes/user/:id
// =======================================================
router.get('/user/:id', async (req, res) => {
    try {
        const targetUserId = req.params.id; // ID ของเจ้าของโปรไฟล์
        const viewerUserId = req.query.userId || 0; // ID ของคนดู (เพื่อเช็คว่าเรากดไลก์หรือยัง)

        const sql = `
            SELECT 
                n.note_id AS id,
                n.title AS note_title,
                n.thumbnail_url AS file_img,
                u.file_img as profile,
                u.nickname,
                n.views,
                s.subject_code AS note_code,
                s.subject_name,
                u.username AS uploader,
                
                -- 🔥 เช็คว่า "คนดู" เคยไลก์โน้ตนี้ไหม
                (SELECT COUNT(*) FROM likes WHERE note_id = n.note_id AND user_id = ?) AS is_liked,
                
                -- นับยอดไลก์รวมทั้งหมด
                (SELECT COUNT(*) FROM likes WHERE note_id = n.note_id) AS total_likes,

                COUNT(DISTINCT c.comment_id) AS comment_count,
                GROUP_CONCAT(DISTINCT t.tag_name) AS tags
            FROM notes AS n
            JOIN users u ON n.uploader_id = u.user_id
            JOIN subjects s ON n.subject_id = s.subject_id
            LEFT JOIN comments c ON n.note_id = c.note_id
            LEFT JOIN note_tags nt ON n.note_id = nt.note_id
            LEFT JOIN tags t ON nt.tag_id = t.tag_id
            
            -- 🔥 กรองเฉพาะโน้ตที่ user คนนี้เป็นคนอัปโหลด
            WHERE n.uploader_id = ?
            
            GROUP BY n.note_id
            ORDER BY n.created_at DESC
        `;

        // ใส่ viewerUserId ตัวแรก (สำหรับ is_liked) และ targetUserId ตัวที่สอง (สำหรับ WHERE)
        const [rows] = await pool.query(sql, [viewerUserId, targetUserId]);

        // แปลง tags จาก comma-separated string → array
        rows.forEach(row => {
            if (row.tags == null) {
                row.tags = [];
            } else if (typeof row.tags === 'string') {
                row.tags = row.tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
            } else if (!Array.isArray(row.tags)) {
                row.tags = [];
            }
        });

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching user uploads" });
    }
});

// =======================================================
// 2. Tab: โน้ตที่ถูกใจ (Likes)
// Path: /api/notes/user/:id/likes
// =======================================================
router.get('/user/:id/likes', async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const viewerUserId = req.query.userId || 0;

        const sql = `
            SELECT 
                n.note_id AS id,
                n.title AS note_title,
                n.thumbnail_url AS file_img,
                u.file_img as profile, u.nickname,
                n.views,
                s.subject_code AS note_code,
                s.subject_name,
                u.username AS uploader,
                
                (SELECT COUNT(*) FROM likes WHERE note_id = n.note_id AND user_id = ?) AS is_liked,
                (SELECT COUNT(*) FROM likes WHERE note_id = n.note_id) AS total_likes,

                COUNT(DISTINCT c.comment_id) AS comment_count,
                GROUP_CONCAT(DISTINCT t.tag_name) AS tags
            FROM notes n
            -- 🔥 JOIN กับตาราง likes เพื่อเอาเฉพาะโน้ตที่ targetUser เคยไลก์
            JOIN likes l ON n.note_id = l.note_id 
            JOIN users u ON n.uploader_id = u.user_id
            JOIN subjects s ON n.subject_id = s.subject_id
            LEFT JOIN comments c ON n.note_id = c.note_id
            LEFT JOIN note_tags nt ON n.note_id = nt.note_id
            LEFT JOIN tags t ON nt.tag_id = t.tag_id
            
            -- 🔥 กรองจากตาราง likes
            WHERE l.user_id = ?
            
            GROUP BY n.note_id
            ORDER BY l.created_at DESC
        `;

        const [rows] = await pool.query(sql, [viewerUserId, targetUserId]);

        rows.forEach(row => {
            if (row.tags == null) {
                row.tags = [];
            } else if (typeof row.tags === 'string') {
                row.tags = row.tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
            } else if (!Array.isArray(row.tags)) {
                row.tags = [];
            }
        });

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching liked notes" });
    }
});

// =======================================================
// 3. Tab: รายการโปรด (Favorites)
// Path: /api/notes/user/:id/favorites
// =======================================================
router.get('/user/:id/favorites', async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const viewerUserId = req.query.userId || 0;

        const sql = `
            SELECT 
                n.note_id AS id,
                n.title AS note_title,
                n.thumbnail_url AS file_img,
                u.file_img as profile, u.nickname,
                n.views,
                s.subject_code AS note_code,
                s.subject_name,
                u.username AS uploader,
                
                (SELECT COUNT(*) FROM likes WHERE note_id = n.note_id AND user_id = ?) AS is_liked,
                (SELECT COUNT(*) FROM likes WHERE note_id = n.note_id) AS total_likes,

                COUNT(DISTINCT c.comment_id) AS comment_count,
                (
                    SELECT JSON_ARRAYAGG(t.tag_name)
                    FROM note_tags nt
                    JOIN tags t ON nt.tag_id = t.tag_id
                    WHERE nt.note_id = n.note_id
                ) AS tags
            FROM notes n
            -- 🔥 JOIN กับตาราง favorites
            JOIN favorites f ON n.note_id = f.note_id 
            JOIN users u ON n.uploader_id = u.user_id
            JOIN subjects s ON n.subject_id = s.subject_id
            LEFT JOIN comments c ON n.note_id = c.note_id
            
            -- 🔥 กรองจากตาราง favorites
            WHERE f.user_id = ?
            
            GROUP BY n.note_id
            ORDER BY f.created_at DESC
        `;

        const [rows] = await pool.query(sql, [viewerUserId, targetUserId]);

        rows.forEach(row => {
            if (typeof row.tags === "string") {
                try { row.tags = JSON.parse(row.tags); } catch { row.tags = []; }
            }
        });

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching favorite notes" });
    }
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let uploadPath = './public/files/pdfs'; // Default
        
        if (file.fieldname === 'coverImage') {
            uploadPath = './public/images/covers';
        }
        
        // สร้างโฟลเดอร์ถ้ายังไม่มี
        if (!fs.existsSync(uploadPath)){
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// --- 2. ตัวกรองไฟล์ (PDF และ รูปภาพ) ---
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || 
        file.mimetype === 'image/jpeg' || 
        file.mimetype === 'image/png') {
        cb(null, true);
    } else {
        cb(new Error('รองรับเฉพาะไฟล์ PDF และรูปภาพเท่านั้น'), false);
    }
};

const Upload = multer({ storage: storage, fileFilter: fileFilter });

// --- 3. Route Upload ---
router.post('/', Upload.fields([
    { name: 'pdfFile', maxCount: 1 }, 
    { name: 'coverImage', maxCount: 1 }
]), async (req, res) => {

    // 1. เช็คไฟล์ (เหมือนเดิม)
    if (!req.files || !req.files['pdfFile'] || !req.files['coverImage']) {
        return res.status(400).json({ message: "ข้อมูลไม่ครบ" });
    }

    try {
        const pdfFile = req.files['pdfFile'][0];
        const coverImage = req.files['coverImage'][0];
        const { title, description, subject_name, tags, uploader_id } = req.body;

        const fileUrl = '/' + pdfFile.path.replace(/\\/g, '/').replace('public/', '');
        const thumbUrl = '/' + coverImage.path.replace(/\\/g, '/').replace('public/', '');

        // -------------------------------------------------------------
        // ส่วนที่ทำให้ง่ายขึ้น: ใช้ pool.query ตรงๆ ไม่ต้องขอ connection
        // -------------------------------------------------------------
        
        let finalSubjectId;

        // A. เช็คก่อนว่ามีวิชานี้ไหม?
        const [existingSub] = await pool.query(
            'SELECT subject_id FROM subjects WHERE subject_name = ?', 
            [subject_name]
        );

        if (existingSub.length > 0) {
            // ✅ มีแล้ว -> ใช้ ID เดิม
            finalSubjectId = existingSub[0].subject_id;
        } else {
            // 🆕 ยังไม่มี -> สร้างใหม่เลย
            const tempCode = "NEW-" + Math.floor(Math.random() * 1000);
            
            const [newSub] = await pool.query(
                'INSERT INTO subjects (subject_code, subject_name) VALUES (?, ?)',
                [tempCode, subject_name]
            );
            
            finalSubjectId = newSub.insertId; // ได้ ID ใหม่
        }

        // B. บันทึก Note (ใช้ finalSubjectId)
        const [noteResult] = await pool.query(
            `INSERT INTO notes (title, description, file_url, thumbnail_url, uploader_id, subject_id) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [title, description || '', fileUrl, thumbUrl, uploader_id, finalSubjectId]
        );

        const newNoteId = noteResult.insertId;

        // C. บันทึก Tags (ถ้ามี)
        if (tags && tags.trim() !== '') {
            const tagList = tags.split(',').map(t => t.trim()).filter(t => t !== '');
            
            for (const tagName of tagList) {
                // เพิ่ม Tag (IGNORE คือถ้ามีแล้วก็ข้ามไป ไม่ error)
                await pool.query(`INSERT IGNORE INTO tags (tag_name) VALUES (?)`, [tagName]);
                
                // หา ID ของ Tag
                const [tagRes] = await pool.query(`SELECT tag_id FROM tags WHERE tag_name = ?`, [tagName]);
                
                if (tagRes.length > 0) {
                    // จับคู่ Note กับ Tag
                    await pool.query(
                        `INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)`, 
                        [newNoteId, tagRes[0].tag_id]
                    );
                }
            }
        }

        res.status(201).json({ message: "อัปโหลดเรียบร้อย" });

    } catch (err) {
        console.error("Upload Error:", err);
        res.status(500).json({ message: "เกิดข้อผิดพลาด" });
    }
});


// 
// 
// 
// 
// 

router.get('/detail/:id', async (req, res) => {
    try {
        const noteId = req.params.id;
        const currentUserId = req.query.userId || 0; // รับ userId คนที่ดูอยู่ (ถ้าไม่มีให้เป็น 0)

        // อัปเดตยอดวิว (เหมือนเดิม)
        await pool.query('UPDATE notes SET views = views + 1 WHERE note_id = ?', [noteId]);

        // Query ข้อมูล (เพิ่มส่วนเช็ค is_liked และ is_saved)
        const sql = `
            SELECT 
                n.*, 
                u.nickname, u.file_img AS uploader_img,
                s.subject_code, s.subject_name,
                -- เช็คว่าคนนี้เคยไลก์ไหม (ถ้าเคยจะได้ 1, ไม่เคยได้ 0)
                (SELECT COUNT(*) FROM likes WHERE note_id = n.note_id AND user_id = ?) AS is_liked,
                -- เช็คว่าคนนี้เคยเซฟไหม
                (SELECT COUNT(*) FROM favorites WHERE note_id = n.note_id AND user_id = ?) AS is_saved,
                -- นับยอดไลก์รวมทั้งหมด
                (SELECT COUNT(*) FROM likes WHERE note_id = n.note_id) AS total_likes,
                (SELECT COUNT(*) FROM favorites WHERE note_id = n.note_id) AS total_saves
            FROM notes n
            JOIN users u ON n.uploader_id = u.user_id
            JOIN subjects s ON n.subject_id = s.subject_id
            WHERE n.note_id = ?
        `;

        const [rows] = await pool.query(sql, [currentUserId, currentUserId, noteId]);

        if (rows.length === 0) return res.status(404).json({ message: "Note not found" });

        // ... (Logic จัดการ Path รูปภาพ เหมือนเดิม) ...
        // ...

        res.json(rows[0]);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error" });
    }
});
// ---------------------------------------------------
// 1. GET: ดึงคอมเมนต์ทั้งหมดของ Note ID นั้นๆ
// ---------------------------------------------------
router.get('/comments/:noteId', async (req, res) => {
    try {
        const noteId = req.params.noteId;

        const sql = `
            SELECT 
                c.comment_id, 
                c.content, 
                c.created_at,
                u.user_id,
                u.username, 
                u.nickname, 
                u.file_img
            FROM comments c
            JOIN users u ON c.user_id = u.user_id
            WHERE c.note_id = ?
            ORDER BY c.created_at DESC
        `;

        const [rows] = await pool.query(sql, [noteId]);
        
        res.json(rows); 

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error fetching comments" });
    }
});

// ---------------------------------------------------
// 2. POST: เพิ่มคอมเมนต์ใหม่
// ---------------------------------------------------
router.post('/comments', async (req, res) => {
    try {
        const { note_id, user_id, content } = req.body;
        if (!content || !note_id || !user_id) {
            return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
        }

        const sql = `INSERT INTO comments (note_id, user_id, content) VALUES (?, ?, ?)`;
        await pool.query(sql, [note_id, user_id, content]);

        res.json({ message: "เพิ่มคอมเมนต์สำเร็จ" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error adding comment" });
    }
});


router.post('/like', async (req, res) => {
    try {
        const { noteId, userId } = req.body; // รับค่าจากหน้าบ้าน

        // 1. เช็คก่อนว่าเคยไลก์หรือยัง
        const checkSql = `SELECT * FROM likes WHERE note_id = ? AND user_id = ?`;
        const [existing] = await pool.query(checkSql, [noteId, userId]);

        if (existing.length > 0) {
            // A. ถ้าเคยไลก์แล้ว -> ให้ "ลบออก" (Unlike)
            await pool.query(`DELETE FROM likes WHERE note_id = ? AND user_id = ?`, [noteId, userId]);
            res.json({ liked: false, message: "Unliked" });
        } else {
            // B. ถ้ายังไม่เคย -> ให้ "เพิ่มเข้าไป" (Like)
            await pool.query(`INSERT INTO likes (note_id, user_id) VALUES (?, ?)`, [noteId, userId]);
            res.json({ liked: true, message: "Liked" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error toggling like" });
    }
});

// ---------------------------------------------------
// 2. Toggle Favorite (กดเซฟ / ยกเลิกเซฟ)
// ---------------------------------------------------
router.post('/favorite', async (req, res) => {
    try {
        const { noteId, userId } = req.body;

        const checkSql = `SELECT * FROM favorites WHERE note_id = ? AND user_id = ?`;
        const [existing] = await pool.query(checkSql, [noteId, userId]);

        if (existing.length > 0) {
            // A. ถ้าเคยเซฟแล้ว -> ให้ "ลบออก" (Unsave)
            await pool.query(`DELETE FROM favorites WHERE note_id = ? AND user_id = ?`, [noteId, userId]);
            res.json({ saved: false, message: "Removed from favorites" });
        } else {
            // B. ถ้ายังไม่เคย -> ให้ "เพิ่มเข้าไป" (Save)
            await pool.query(`INSERT INTO favorites (note_id, user_id) VALUES (?, ?)`, [noteId, userId]);
            res.json({ saved: true, message: "Added to favorites" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error toggling favorite" });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const noteId = req.params.id;
        const { userId } = req.body; // รับ userId มาเพื่อเช็คว่าเป็นเจ้าของไหม

        // 1. ดึงข้อมูลโน้ตมาก่อน เพื่อดูว่าใครเป็นเจ้าของ และไฟล์ชื่ออะไร
        const [rows] = await pool.query('SELECT uploader_id, file_url, thumbnail_url FROM notes WHERE note_id = ?', [noteId]);

        if (rows.length === 0) return res.status(404).json({ message: "ไม่พบโน้ต" });
        const note = rows[0];

        // 2. เช็คว่าเป็นเจ้าของไหม (กันคนอื่นมาเนียนลบ)
        if (note.uploader_id != userId) {
            return res.status(403).json({ message: "ไม่มีสิทธิ์ลบโน้ตนี้" });
        }

        // 3. ลบไฟล์ออกจากเครื่อง Server (ถ้ามี)
        try {
            // แปลง URL กลับเป็น Path ไฟล์จริง (ตัด / ออก)
            const pdfPath = `./public${note.file_url}`; 
            const imgPath = `./public${note.thumbnail_url}`;
            
            if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        } catch (fileErr) {
            console.error("Error deleting file:", fileErr);
            // ให้ทำงานต่อได้ แม้ลบไฟล์ไม่สำเร็จ (ลบใน DB ก็ยังดี)
        }

        // 4. ลบข้อมูลจาก Database
        await pool.query('DELETE FROM notes WHERE note_id = ?', [noteId]);

        res.json({ message: "ลบโน้ตสำเร็จ" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "เกิดข้อผิดพลาด" });
    }
});


module.exports = router;