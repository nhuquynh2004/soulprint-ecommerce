// Nạp AppModule vào lần biên dịch test: dự án NgModule (--no-standalone) cần module khai báo component
// có mặt khi biên dịch AOT, nếu không trình biên dịch báo "is not a known element".
import './app/app-module';
