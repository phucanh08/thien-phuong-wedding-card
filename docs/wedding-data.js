// Nguồn nội dung duy nhất của thiệp Thiện & Phương.
// Thiệp (v2/) vẽ từ window.WEDDING_DATA khi không dùng được bản xuất bản (C6); đổi nội dung ở đây, không sửa markup.
// Mọi giá trị chứa "TODO" là placeholder chờ nội dung thật.
// Ảnh thật trong assets/images/photos/ (…-large 1600px, …-small 600px); QR và favicon vẫn là placeholder trong assets/images/placeholder/.
window.WEDDING_DATA = {
    // Field cũ (C6), giữ trong data nhưng bị bỏ qua: thiệp chỉ còn bản v2, đường dẫn gốc luôn mở v2.
    site: {
        version: "v1"
    },

    meta: {
        title: "Thiện & Phương Wedding",
        description: "Trân trọng kính mời bạn đến dự lễ cưới của Thiện & Phương vào ngày 25/10/2026.",
        previewImage: "assets/images/placeholder/landscape.svg",
        favicon: "assets/images/placeholder/favicon.svg"
    },

    couple: {
        groom: {
            fullName: "Nguyễn Đức Thiện",
            shortName: "Thiện",
            birthday: "TODO: dd/mm/yyyy",
            bio: "TODO: vài dòng giới thiệu về chú rể.",
            photo: "assets/images/photos/photo-16-small.webp",
            father: "Nguyễn Đức Long",
            mother: "Hồ Thị Huế",
            address: "Số 63, đường Đền Trình Tuyết Sơn, Phú Yên, Hương Sơn, Mỹ Đức, Hà Nội",
            facebook: null // tuỳ chọn: link Facebook, null để ẩn
        },
        bride: {
            fullName: "Triệu Thị Phương",
            shortName: "Phương",
            birthday: "TODO: dd/mm/yyyy",
            bio: "TODO: vài dòng giới thiệu về cô dâu.",
            photo: "assets/images/photos/photo-01-small.webp",
            father: "Triệu Văn Tiến",
            mother: "Nguyễn Thị Lan",
            address: "Khu Ngọc Tỉnh - Xã Lâm Thao - Tỉnh Phú Thọ",
            facebook: null
        }
    },

    wedding: {
        dateISO: "2026-10-25", // YYYY-MM-DD
        lunarText: "16 tháng 9 năm Bính Ngọ",
        // tuỳ chọn: ảnh lớn ở banner và ảnh mục Lời Ngỏ
        mainImage: "assets/images/photos/photo-04-large.webp",
        invitationImage: "assets/images/photos/photo-14-large.webp",
        // tuỳ chọn: lời ngỏ, mỗi phần tử là một dòng
        invitationText: [
            "TODO: lời ngỏ gửi bạn bè, người thân.",
            "TODO: dòng thứ hai của lời ngỏ."
        ]
    },

    // Nhà trai đã có giờ (endISO = startISO vì chưa có giờ kết thúc); nhà gái chưa có giờ nên startISO/endISO chỉ có ngày (lịch thành cả ngày). Thêm "T09:00:00+07:00" khi có giờ.
    events: [
        {
            key: "groom-drinks",
            title: "TIỆC CƯỚI NHÀ TRAI",
            side: "groom",
            startISO: "2026-10-24T16:30:00+07:00",
            endISO: "2026-10-24T16:30:00+07:00",
            lunarText: "15 tháng 9 năm Bính Ngọ",
            venue: "Tư gia nhà trai",
            address: "Số 63, đường Đền Trình Tuyết Sơn, Phú Yên, Hương Sơn, Mỹ Đức, Hà Nội",
            mapUrl: "https://www.google.com/maps/search/?api=1&query=S%E1%BB%91%2063%2C%20%C4%91%C6%B0%E1%BB%9Dng%20%C4%90%E1%BB%81n%20Tr%C3%ACnh%20Tuy%E1%BA%BFt%20S%C6%A1n%2C%20Ph%C3%BA%20Y%C3%AAn%2C%20H%C6%B0%C6%A1ng%20S%C6%A1n%2C%20M%E1%BB%B9%20%C4%90%E1%BB%A9c%2C%20H%C3%A0%20N%E1%BB%99i",
            image: "assets/images/photos/photo-10-small.webp",
            dressCode: ["#32435f", "#ffffff", "#57233a"]
        },
        {
            key: "groom-ceremony",
            title: "LỄ THÀNH HÔN",
            side: "groom",
            startISO: "2026-10-25T10:00:00+07:00",
            endISO: "2026-10-25T10:00:00+07:00",
            lunarText: "16 tháng 9 năm Bính Ngọ",
            venue: "Tư gia nhà trai",
            address: "Số 63, đường Đền Trình Tuyết Sơn, Phú Yên, Hương Sơn, Mỹ Đức, Hà Nội",
            mapUrl: "https://www.google.com/maps/search/?api=1&query=S%E1%BB%91%2063%2C%20%C4%91%C6%B0%E1%BB%9Dng%20%C4%90%E1%BB%81n%20Tr%C3%ACnh%20Tuy%E1%BA%BFt%20S%C6%A1n%2C%20Ph%C3%BA%20Y%C3%AAn%2C%20H%C6%B0%C6%A1ng%20S%C6%A1n%2C%20M%E1%BB%B9%20%C4%90%E1%BB%A9c%2C%20H%C3%A0%20N%E1%BB%99i",
            image: "assets/images/photos/photo-03-small.webp",
            dressCode: ["#7fb174", "#504e63", "#632a7e"]
        },
        {
            key: "bride-drinks",
            title: "TIỆC THÂN MẬT NHÀ GÁI",
            side: "bride",
            startISO: "2026-10-24T16:00:00+07:00",
            endISO: "2026-10-24T17:00:00+07:00",
            lunarText: "15 tháng 9 năm Bính Ngọ",
            venue: "Tư gia nhà gái",
            address: "Ngách 08/40 Lý Dương Cảnh (Khu Ngọc Tỉnh) - Xã Lâm Thao - Tỉnh Phú Thọ",
            mapUrl: "https://maps.app.goo.gl/idpeM6Fe8np7LDqF7",
            note: "Đón khách 15h · Bạn bè 16h–17h", // tuỳ chọn: dòng ghi chú dưới sự kiện
            image: "assets/images/photos/photo-11-small.webp",
            dressCode: ["#504e63", "#cc8a4d", "#bc5f6a"]
        },
        {
            key: "bride-ceremony",
            title: "LỄ CƯỚI NHÀ GÁI",
            side: "bride",
            startISO: "2026-10-25",
            endISO: "2026-10-25",
            lunarText: "16 tháng 9 năm Bính Ngọ",
            venue: "TODO: tư gia nhà gái",
            address: "TODO: địa chỉ nhà gái",
            mapUrl: "https://maps.google.com/?q=TODO",
            image: "assets/images/photos/photo-06-small.webp",
            dressCode: ["#eda2b6", "#ffffff", "#623262"]
        }
    ],

    story: [
        { date: "TODO: ngày", title: "TODO: lần đầu gặp nhau", text: "TODO: kể lại khoảnh khắc đầu tiên.", image: "assets/images/photos/photo-12-small.webp" },
        { date: "TODO: ngày", title: "TODO: lời tỏ tình", text: "TODO: kể lại lời tỏ tình.", image: "assets/images/photos/photo-13-small.webp" },
        { date: "TODO: ngày", title: "TODO: cầu hôn", text: "TODO: kể lại lần cầu hôn.", image: "assets/images/photos/photo-15-small.webp" },
        { date: "TODO: ngày", title: "TODO: lễ đính hôn", text: "TODO: kể lại lễ đính hôn.", image: "assets/images/photos/photo-09-small.webp" }
    ],

    // caption (tuỳ chọn): chú thích khi mở ảnh lớn; bỏ trống thì dùng câu trích dẫn mặc định
    // featuredV2: true (tuỳ chọn; ô "Hiện ở Album" của trang quản lý) -> hiện ở băng ảnh Album và làm ảnh
    // bìa "With you" khi thiếu wedding.coverImages. Không item nào featuredV2 thì dùng ảnh featured: true,
    // không có thì 6 item đầu. "Tất cả hình ảnh" và lightbox mở toàn bộ album.
    gallery: [
        { small: "assets/images/photos/photo-01-small.webp", large: "assets/images/photos/photo-01-large.webp", featured: true },
        { small: "assets/images/photos/photo-02-small.webp", large: "assets/images/photos/photo-02-large.webp" },
        { small: "assets/images/photos/photo-03-small.webp", large: "assets/images/photos/photo-03-large.webp", featured: true },
        { small: "assets/images/photos/photo-04-small.webp", large: "assets/images/photos/photo-04-large.webp", featured: true },
        { small: "assets/images/photos/photo-05-small.webp", large: "assets/images/photos/photo-05-large.webp" },
        { small: "assets/images/photos/photo-06-small.webp", large: "assets/images/photos/photo-06-large.webp" },
        { small: "assets/images/photos/photo-07-small.webp", large: "assets/images/photos/photo-07-large.webp" },
        { small: "assets/images/photos/photo-08-small.webp", large: "assets/images/photos/photo-08-large.webp" },
        { small: "assets/images/photos/photo-09-small.webp", large: "assets/images/photos/photo-09-large.webp" },
        { small: "assets/images/photos/photo-10-small.webp", large: "assets/images/photos/photo-10-large.webp" },
        { small: "assets/images/photos/photo-11-small.webp", large: "assets/images/photos/photo-11-large.webp" },
        { small: "assets/images/photos/photo-12-small.webp", large: "assets/images/photos/photo-12-large.webp", featured: true },
        { small: "assets/images/photos/photo-13-small.webp", large: "assets/images/photos/photo-13-large.webp", featured: true },
        { small: "assets/images/photos/photo-14-small.webp", large: "assets/images/photos/photo-14-large.webp", featured: true },
        { small: "assets/images/photos/photo-15-small.webp", large: "assets/images/photos/photo-15-large.webp", featured: true },
        { small: "assets/images/photos/photo-16-small.webp", large: "assets/images/photos/photo-16-large.webp", featured: true },
        { small: "assets/images/photos/photo-17-small.webp", large: "assets/images/photos/photo-17-large.webp" }
    ],

    video: null, // { youtubeId: "..." } để hiện mục Video Cưới

    donate: {
        groom: {
            bank: "MB Bank (Ngân hàng Quân Đội)",
            accountName: "NGUYEN DUC THIEN",
            accountNumber: "608062626",
            qr: "assets/images/qr/groom.webp"
        },
        bride: {
            bank: "Techcombank",
            accountName: "TRIEU THI PHUONG",
            accountNumber: "6366661998",
            qr: "assets/images/qr/bride.webp"
        }
    },

    music: {
        src: "assets/musics/i-do-lofi.mp3",
        title: "I Do (911) – Lo-Fi cover"
    }
};
