// ===== PRODUCT MODEL =====
// Đây là tầng Model - chứa dữ liệu và cấu trúc dữ liệu
// Trong thực tế sẽ dùng Database (MongoDB, MySQL,...), ở đây dùng mảng để học

const products = [
    {
        id: 1,
        name: "iPhone 16 Pro Max",
        slug: "iphone-16-pro-max",
        stock: 10,
        price: 34990000,
        image: "https://picsum.photos/seed/iphone/400/300",
        description: "iPhone 16 Pro Max với chip A18 Pro, camera 48MP, màn hình 6.9 inch Super Retina XDR. Thiết kế titanium cao cấp với thời lượng pin cả ngày."
    },
    {
        id: 2,
        name: "Samsung Galaxy S25 Ultra",
        slug: "samsung-galaxy-s25-ultra",
        stock: 2,
        price: 33990000,
        image: "https://picsum.photos/seed/samsung/400/300",
        description: "Samsung Galaxy S25 Ultra trang bị chip Snapdragon 8 Elite, camera 200MP, S Pen tích hợp. Màn hình Dynamic AMOLED 2X 6.8 inch, pin 5000mAh."
    },
    {
        id: 3,
        name: "MacBook Pro M4",
        slug: "macbook-pro-m4",
        stock: 199,
        price: 49990000,
        image: "https://picsum.photos/seed/macbook/400/300",
        description: "MacBook Pro với chip M4 Pro, RAM 18GB, SSD 512GB. Màn hình Liquid Retina XDR 14 inch, thời lượng pin lên đến 17 giờ."
    }
];

module.exports = products;
