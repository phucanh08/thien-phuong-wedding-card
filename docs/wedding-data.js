// Nguồn nội dung duy nhất của thiệp Thiện & Phương.
// index.html chỉ đọc window.WEDDING_DATA; đổi nội dung ở đây, không sửa markup.
// Mọi giá trị chứa "TODO" là placeholder chờ nội dung thật.
// Ảnh trong assets/images/placeholder/ và nhạc assets/musics/placeholder.m4a là tạm, thay khi có file thật.
window.WEDDING_DATA = {
    meta: {
        title: "Thiện & Phương Wedding",
        description: "TODO: mô tả ngắn hiển thị khi chia sẻ link (ngày cưới, câu chúc)",
        previewImage: "assets/images/placeholder/landscape.svg",
        favicon: "assets/images/placeholder/favicon.svg"
    },

    couple: {
        groom: {
            fullName: "TODO: họ tên đầy đủ chú rể (Thiện)",
            shortName: "Thiện",
            birthday: "TODO: dd/mm/yyyy",
            bio: "TODO: vài dòng giới thiệu về chú rể.",
            photo: "assets/images/placeholder/square.svg",
            father: "TODO: tên bố chú rể",
            mother: "TODO: tên mẹ chú rể",
            address: "TODO: địa chỉ nhà trai",
            facebook: null // tuỳ chọn: link Facebook, null để ẩn
        },
        bride: {
            fullName: "TODO: họ tên đầy đủ cô dâu (Phương)",
            shortName: "Phương",
            birthday: "TODO: dd/mm/yyyy",
            bio: "TODO: vài dòng giới thiệu về cô dâu.",
            photo: "assets/images/placeholder/square.svg",
            father: "TODO: tên bố cô dâu",
            mother: "TODO: tên mẹ cô dâu",
            address: "TODO: địa chỉ nhà gái",
            facebook: null
        }
    },

    wedding: {
        dateISO: "2026-12-20", // TODO: ngày cưới thật (YYYY-MM-DD)
        lunarText: "TODO: ngày âm lịch",
        // tuỳ chọn: ảnh lớn ở banner và ảnh mục Lời Ngỏ
        mainImage: "assets/images/placeholder/portrait.svg",
        invitationImage: "assets/images/placeholder/landscape.svg",
        // tuỳ chọn: lời ngỏ, mỗi phần tử là một dòng
        invitationText: [
            "TODO: lời ngỏ gửi bạn bè, người thân.",
            "TODO: dòng thứ hai của lời ngỏ."
        ]
    },

    events: [
        {
            key: "bride-ceremony",
            title: "LỄ CƯỚI NHÀ GÁI",
            side: "bride",
            startISO: "2026-12-20T09:00:00+07:00",
            endISO: "2026-12-20T10:00:00+07:00",
            lunarText: "TODO: ngày âm lịch",
            venue: "TODO: tư gia nhà gái",
            address: "TODO: địa chỉ nhà gái",
            mapUrl: "https://maps.google.com/?q=TODO",
            image: "assets/images/placeholder/portrait.svg",
            dressCode: ["#eda2b6", "#ffffff", "#623262"] // tuỳ chọn: màu trang phục gợi ý
        },
        {
            key: "bride-party",
            title: "TIỆC CƯỚI NHÀ GÁI",
            side: "bride",
            startISO: "2026-12-19T16:00:00+07:00",
            endISO: "2026-12-19T19:00:00+07:00",
            lunarText: "TODO: ngày âm lịch",
            venue: "TODO: nơi tổ chức tiệc nhà gái",
            address: "TODO: địa chỉ tiệc nhà gái",
            mapUrl: "https://maps.google.com/?q=TODO",
            image: "assets/images/placeholder/portrait.svg",
            dressCode: ["#504e63", "#cc8a4d", "#bc5f6a"]
        },
        {
            key: "groom-ceremony",
            title: "LỄ CƯỚI NHÀ TRAI",
            side: "groom",
            startISO: "2026-12-20T10:00:00+07:00",
            endISO: "2026-12-20T12:00:00+07:00",
            lunarText: "TODO: ngày âm lịch",
            venue: "TODO: tư gia nhà trai",
            address: "TODO: địa chỉ nhà trai",
            mapUrl: "https://maps.google.com/?q=TODO",
            image: "assets/images/placeholder/portrait.svg",
            dressCode: ["#32435f", "#ffffff", "#57233a"]
        },
        {
            key: "groom-party",
            title: "TIỆC CƯỚI NHÀ TRAI",
            side: "groom",
            startISO: "2026-12-19T15:00:00+07:00",
            endISO: "2026-12-19T19:00:00+07:00",
            lunarText: "TODO: ngày âm lịch",
            venue: "TODO: nơi tổ chức tiệc nhà trai",
            address: "TODO: địa chỉ tiệc nhà trai",
            mapUrl: "https://maps.google.com/?q=TODO",
            image: "assets/images/placeholder/portrait.svg",
            dressCode: ["#7fb174", "#504e63", "#632a7e"]
        }
    ],

    story: [
        { date: "TODO: ngày", title: "TODO: lần đầu gặp nhau", text: "TODO: kể lại khoảnh khắc đầu tiên.", image: "assets/images/placeholder/landscape.svg" },
        { date: "TODO: ngày", title: "TODO: lời tỏ tình", text: "TODO: kể lại lời tỏ tình.", image: "assets/images/placeholder/landscape.svg" },
        { date: "TODO: ngày", title: "TODO: cầu hôn", text: "TODO: kể lại lần cầu hôn.", image: "assets/images/placeholder/landscape.svg" },
        { date: "TODO: ngày", title: "TODO: lễ đính hôn", text: "TODO: kể lại lễ đính hôn.", image: "assets/images/placeholder/landscape.svg" }
    ],

    // caption (tuỳ chọn): chú thích khi mở ảnh lớn; bỏ trống thì dùng câu trích dẫn mặc định
    gallery: [
        { small: "assets/images/placeholder/portrait.svg", large: "assets/images/placeholder/portrait.svg" },
        { small: "assets/images/placeholder/landscape.svg", large: "assets/images/placeholder/landscape.svg" },
        { small: "assets/images/placeholder/square.svg", large: "assets/images/placeholder/square.svg" },
        { small: "assets/images/placeholder/portrait.svg", large: "assets/images/placeholder/portrait.svg" },
        { small: "assets/images/placeholder/landscape.svg", large: "assets/images/placeholder/landscape.svg" },
        { small: "assets/images/placeholder/square.svg", large: "assets/images/placeholder/square.svg" }
    ],

    video: null, // { youtubeId: "..." } để hiện mục Video Cưới

    donate: {
        groom: {
            bank: "TODO: ngân hàng",
            accountName: "TODO: TEN CHU TAI KHOAN",
            accountNumber: "TODO: số tài khoản",
            qr: "assets/images/placeholder/qr.svg",
            branch: "TODO: chi nhánh" // tuỳ chọn
        },
        bride: {
            bank: "TODO: ngân hàng",
            accountName: "TODO: TEN CHU TAI KHOAN",
            accountNumber: "TODO: số tài khoản",
            qr: "assets/images/placeholder/qr.svg",
            branch: "TODO: chi nhánh"
        }
    },

    music: {
        src: "assets/musics/placeholder.m4a",
        title: "TODO: tên bài nhạc nền"
    }
};
