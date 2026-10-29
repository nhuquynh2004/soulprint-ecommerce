import { Component, ViewEncapsulation, inject, signal } from '@angular/core';
import { CatalogApiService } from '../../services/catalog-apiservice';
import { ChatService } from '../../services/chat';

interface FooterLink {
  label: string;
  link: string;
  query?: Record<string, string | number>;
  fragment?: string;
  chat?: boolean;
}

// Footer "biển quà" (SCR-02). Email, hotline, mạng xã hội đọc từ Cài đặt cửa hàng
// (API-143), lỗi thì dùng giá trị mặc định. ViewEncapsulation.None: SVG cảnh biển gọi keyframes bằng style nội dòng
// (animation-name: sp-im-d40...) nên tên keyframes phải giữ nguyên; mọi luật trong footer.scss nằm dưới app-footer.
@Component({
  selector: 'app-footer',
  standalone: false,
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
  encapsulation: ViewEncapsulation.None,
})
export class Footer {
  private readonly catalog = inject(CatalogApiService);
  private readonly chat = inject(ChatService);

  readonly year = new Date().getFullYear();
  readonly address = 'Số 669 đường Đỗ Mười, Khu phố 3, Phường Linh Xuân, TP. Hồ Chí Minh';
  readonly contact = signal({ email: 'hotro@soulprint.vn', hotline: '1900 1234' });
  readonly social = signal<Record<string, string>>({});

  readonly groups: { title: string; links: FooterLink[] }[] = [
    {
      title: 'Mua sắm',
      links: [
        { label: 'Danh mục', link: '/san-pham' },
        { label: 'Bộ sưu tập', link: '/', fragment: 'bo-suu-tap' },
        { label: 'Sản phẩm mới', link: '/san-pham', query: { chip: 'moi' } },
        { label: 'Tìm quà cùng AI', link: '/tu-van-qua' },
      ],
    },
    {
      title: 'Chính sách',
      links: [
        { label: 'Đổi trả và hoàn tiền', link: '/chinh-sach/doi-tra' },
        { label: 'Bảo hành', link: '/chinh-sach/bao-hanh' },
        { label: 'Thanh toán và đặt cọc', link: '/chinh-sach/thanh-toan' },
        { label: 'Vận chuyển', link: '/chinh-sach/van-chuyen' },
        { label: 'Bảo mật', link: '/chinh-sach/bao-mat' },
      ],
    },
    {
      title: 'Hỗ trợ',
      links: [
        { label: 'Tra cứu đơn hàng', link: '/tra-cuu-don' },
        { label: 'Hướng dẫn cá nhân hóa', link: '/ve-soulprint/huong-dan-ca-nhan-hoa' },
        // Mở khung chat Sâu Béo, chuyển nhân viên khi cần (UC-CSK-01, CSK-02)
        { label: 'Liên hệ', link: '', chat: true },
      ],
    },
    {
      title: 'Về Soulprint',
      links: [
        { label: 'Câu chuyện thương hiệu', link: '/ve-soulprint/cau-chuyen-thuong-hieu' },
        { label: 'Góc chia sẻ', link: '/ve-soulprint/goc-chia-se' },
        { label: 'Tuyển dụng', link: '/ve-soulprint/tuyen-dung' },
      ],
    },
  ];

  openChat(e: Event): void {
    e.preventDefault();
    this.chat.open();
  }

  constructor() {
    this.catalog.getPublicSettings().subscribe({
      next: (s) => {
        const st = s?.store;
        if (!st) return;
        this.contact.set({ email: st.email || this.contact().email, hotline: st.hotline || this.contact().hotline });
        this.social.set(st.social || {});
      },
      error: () => {},
    });
  }
}
