import { NgModule, provideBrowserGlobalErrorListeners } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { AppRoutingModule } from './app-routing-module';
import { SharedModule } from './shared/shared-module';
import { App } from './app';
import { Header } from './layout/header/header';
import { Footer } from './layout/footer/footer';
import { ChatWidget } from './layout/chat-widget/chat-widget';
import { Home } from './features/home/home';
import { NotFound } from './features/not-found/not-found';
import { ProductList } from './features/product-list/product-list';
import { FilterPanel } from './features/product-list/filter-panel/filter-panel';
import { ProductDetail } from './features/product-detail/product-detail';
import { Policy } from './features/policy/policy';
import { AuthShell } from './features/auth/auth-shell/auth-shell';
import { Login } from './features/auth/login/login';
import { Register } from './features/auth/register/register';
import { GoogleButton } from './features/auth/google-button/google-button';
import { ForgotPassword } from './features/auth/forgot-password/forgot-password';
import { SetPassword } from './features/auth/set-password/set-password';
import { CartPage } from './features/cart/cart-page';
import { CheckoutPage } from './features/checkout/checkout-page';
import { AddressPicker } from './features/checkout/address-picker/address-picker';
import { OrderResult } from './features/checkout/order-result/order-result';
import { UrgentRequest } from './features/checkout/urgent-request/urgent-request';
import { PaymentGateway } from './features/checkout/payment-gateway/payment-gateway';
import { OrderLookup } from './features/order-lookup/order-lookup';
import { GiftAdvisor } from './features/gift-advisor/gift-advisor';
import { AiResultCard } from './features/gift-advisor/ai-result-card/ai-result-card';

// Module gốc: trang cửa hàng tải ngay. Khu Tài khoản, khu Quản trị tải lười (AccountModule, AdminModule).
// SharedModule chứa component dùng chung (Icon, ProductCard, Dialog, PasswordField...) và FormsModule,
// ReactiveFormsModule cho form (Chương V).
@NgModule({
  declarations: [
    App,
    Header,
    Footer,
    ChatWidget,
    Home,
    NotFound,
    ProductList,
    FilterPanel,
    ProductDetail,
    Policy,
    AuthShell,
    Login,
    Register,
    GoogleButton,
    ForgotPassword,
    SetPassword,
    CartPage,
    CheckoutPage,
    AddressPicker,
    OrderResult,
    UrgentRequest,
    PaymentGateway,
    OrderLookup,
    GiftAdvisor,
    AiResultCard,
  ],
  imports: [BrowserModule, SharedModule, AppRoutingModule],
  // provideHttpClient khai báo trong module gốc như slide Chương III
  providers: [provideBrowserGlobalErrorListeners(), provideHttpClient(withFetch())],
  bootstrap: [App],
})
export class AppModule {}
