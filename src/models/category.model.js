// ===== CATEGORY MODEL =====
// In-memory Category records used by the category repository.

const now = () => new Date().toISOString();

const categories = [
    {
        id: 1,
        name: "Điện thoại",
        slug: "dien-thoai",
        description: "Các dòng điện thoại thông minh",
        createdAt: now()
    },
    {
        id: 2,
        name: "Laptop",
        slug: "laptop",
        description: "Máy tính xách tay",
        createdAt: now()
    },
    {
        id: 3,
        name: "Phụ kiện",
        slug: "phu-kien",
        description: "Phụ kiện công nghệ",
        createdAt: now()
    }
];

module.exports = categories;
