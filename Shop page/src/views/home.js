import React, { Fragment } from 'react'

import Script from 'dangerous-html/react'
import { Helmet } from 'react-helmet'

import Banner11 from '../components/banner11'
import './home.css'

const Home = (props) => {
  return (
    <div className="home-container1">
      <Helmet>
        <title>Modest Straight Chamois</title>
        <meta property="og:title" content="Modest Straight Chamois" />
        <link
          rel="canonical"
          href="https://modest-straight-chamois-oa6prc.teleporthq.app/"
        />
      </Helmet>
      <Banner11
        content1={
          <Fragment>
            <span className="home-text1">Shop details</span>
          </Fragment>
        }
        heading1={
          <Fragment>
            <span className="home-text2">Sponsor Name</span>
          </Fragment>
        }
      ></Banner11>
      <div id="productGrid" className="home-product-grid">
        <a href="/product/aero-audio-pro">
          <div className="product-card-link">
            <div className="product-card-inner">
              <div className="image-container">
                <div className="tag-badge">
                  <span>New Arrival</span>
                </div>
                <img
                  src="https://images.pexels.com/photos/33298190/pexels-photo-33298190.jpeg?auto=compress&amp;cs=tinysrgb&amp;w=1500"
                  alt="Aero Audio Pro"
                  className="product-image"
                />
                <div className="card-overlay">
                  <div className="view-label">
                    <span>View Details</span>
                    <span className="view-icon">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                      >
                        <g
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <path d="m12 16l4-4l-4-4m-4 4h8"></path>
                        </g>
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
              <div className="product-details">
                <div className="rating-row">
                  <span className="home-star-icon">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="currentColor"
                        d="m8.243 7.34l-6.38.925l-.113.023a1 1 0 0 0-.44 1.684l4.622 4.499l-1.09 6.355l-.013.11a1 1 0 0 0 1.464.944l5.706-3l5.693 3l.1.046a1 1 0 0 0 1.352-1.1l-1.091-6.355l4.624-4.5l.078-.085a1 1 0 0 0-.633-1.62l-6.38-.926l-2.852-5.78a1 1 0 0 0-1.794 0z"
                      ></path>
                    </svg>
                  </span>
                  <span className="rating-text">4.9</span>
                </div>
                <h3 className="product-title">Aero Audio Pro</h3>
                <div className="points-badge">
                  <span className="points-val">1,250</span>
                  <span className="points-label">Points</span>
                </div>
              </div>
            </div>
          </div>
        </a>
        <a href="/product/chronos-s1">
          <div className="product-card-link">
            <div className="product-card-inner">
              <div className="image-container">
                <img
                  src="https://images.pexels.com/photos/12564670/pexels-photo-12564670.jpeg?auto=compress&amp;cs=tinysrgb&amp;w=1500"
                  alt="Chronos S1 Watch"
                  className="product-image"
                />
                <div className="card-overlay">
                  <div className="view-label">
                    <span>View Details</span>
                    <span className="view-icon">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                      >
                        <g
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <path d="m12 16l4-4l-4-4m-4 4h8"></path>
                        </g>
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
              <div className="product-details">
                <div className="rating-row">
                  <span className="home-star-icon">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="currentColor"
                        d="m8.243 7.34l-6.38.925l-.113.023a1 1 0 0 0-.44 1.684l4.622 4.499l-1.09 6.355l-.013.11a1 1 0 0 0 1.464.944l5.706-3l5.693 3l.1.046a1 1 0 0 0 1.352-1.1l-1.091-6.355l4.624-4.5l.078-.085a1 1 0 0 0-.633-1.62l-6.38-.926l-2.852-5.78a1 1 0 0 0-1.794 0z"
                      ></path>
                    </svg>
                  </span>
                  <span className="rating-text">4.8</span>
                </div>
                <h3 className="product-title">Chronos S1 Watch</h3>
                <div className="points-badge">
                  <span className="points-val">2,400</span>
                  <span className="points-label">Points</span>
                </div>
              </div>
            </div>
          </div>
        </a>
        <a href="/product/nexus-handheld">
          <div className="product-card-link">
            <div className="product-card-inner">
              <div className="image-container">
                <div className="tag-badge limited">
                  <span>Limited Edition</span>
                </div>
                <img
                  src="https://images.pexels.com/photos/14005916/pexels-photo-14005916.jpeg?auto=compress&amp;cs=tinysrgb&amp;w=1500"
                  alt="Nexus Handheld"
                  className="product-image"
                />
                <div className="card-overlay">
                  <div className="view-label">
                    <span>View Details</span>
                    <span className="view-icon">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                      >
                        <g
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <path d="m12 16l4-4l-4-4m-4 4h8"></path>
                        </g>
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
              <div className="product-details">
                <div className="rating-row">
                  <span className="home-star-icon">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="currentColor"
                        d="m8.243 7.34l-6.38.925l-.113.023a1 1 0 0 0-.44 1.684l4.622 4.499l-1.09 6.355l-.013.11a1 1 0 0 0 1.464.944l5.706-3l5.693 3l.1.046a1 1 0 0 0 1.352-1.1l-1.091-6.355l4.624-4.5l.078-.085a1 1 0 0 0-.633-1.62l-6.38-.926l-2.852-5.78a1 1 0 0 0-1.794 0z"
                      ></path>
                    </svg>
                  </span>
                  <span className="rating-text">5.0</span>
                </div>
                <h3 className="product-title">Nexus Handheld</h3>
                <div className="points-badge">
                  <span className="points-val">4,100</span>
                  <span className="points-label">Points</span>
                </div>
              </div>
            </div>
          </div>
        </a>
        <a href="/product/tactile-rgb-keyboard">
          <div className="product-card-link">
            <div className="product-card-inner">
              <div className="image-container">
                <img
                  src="https://images.pexels.com/photos/18311093/pexels-photo-18311093.jpeg?auto=compress&amp;cs=tinysrgb&amp;w=1500"
                  alt="Tactile RGB Keyboard"
                  className="product-image"
                />
                <div className="card-overlay">
                  <div className="view-label">
                    <span>View Details</span>
                    <span className="view-icon">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                      >
                        <g
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <path d="m12 16l4-4l-4-4m-4 4h8"></path>
                        </g>
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
              <div className="product-details">
                <div className="rating-row">
                  <span className="home-star-icon">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="currentColor"
                        d="m8.243 7.34l-6.38.925l-.113.023a1 1 0 0 0-.44 1.684l4.622 4.499l-1.09 6.355l-.013.11a1 1 0 0 0 1.464.944l5.706-3l5.693 3l.1.046a1 1 0 0 0 1.352-1.1l-1.091-6.355l4.624-4.5l.078-.085a1 1 0 0 0-.633-1.62l-6.38-.926l-2.852-5.78a1 1 0 0 0-1.794 0z"
                      ></path>
                    </svg>
                  </span>
                  <span className="rating-text">4.7</span>
                </div>
                <h3 className="product-title">Tactile RGB Keyboard</h3>
                <div className="points-badge">
                  <span className="points-val">850</span>
                  <span className="points-label">Points</span>
                </div>
              </div>
            </div>
          </div>
        </a>
      </div>
      <div className="home-container2">
        <div className="home-container3">
          <Script
            html={`<script>
(function(){
  ;(function () {
    const cards = document.querySelectorAll(".product-card-link")

    cards.forEach((card) => {
      const inner = card.querySelector(".product-card-inner")

      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        const centerX = rect.width / 2
        const centerY = rect.height / 2

        const rotateX = (y - centerY) / 15
        const rotateY = (centerX - x) / 15

        inner.style.transform = \`perspective(1200px) rotateX(\${rotateX}deg) rotateY(\${rotateY}deg) translateY(-10px)\`
      })

      card.addEventListener("mouseleave", () => {
        inner.style.transform = \`perspective(1200px) rotateX(0deg) rotateY(0deg) translateY(0)\`
      })
    })
  })()
})()
</script>`}
          ></Script>
        </div>
      </div>
      <div className="home-container4">
        <div className="home-container5">
          <Script
            html={`<script>
(function(){
  // Interactive Product Grid Effects
  const productCards = document.querySelectorAll(".product-card")

  productCards.forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const centerX = rect.width / 2
      const centerY = rect.height / 2

      const rotateX = (y - centerY) / 20
      const rotateY = (centerX - x) / 20

      const inner = card.querySelector(".card-inner")
      inner.style.transform = \`perspective(1000px) rotateX(\${rotateX}deg) rotateY(\${rotateY}deg) translateY(-5px)\`
    })

    card.addEventListener("mouseleave", () => {
      const inner = card.querySelector(".card-inner")
      inner.style.transform = "perspective(1000px) rotateX(0) rotateY(0) translateY(0)"
    })
  })

  // Simple Click Feedback for Cart
  const cartButtons = document.querySelectorAll(".cart-add")
  cartButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      const originalContent = btn.innerHTML
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
      btn.style.backgroundColor = "#00b894"
      btn.style.color = "#fff"

      setTimeout(() => {
        btn.innerHTML = originalContent
        btn.style.backgroundColor = ""
        btn.style.color = ""
      }, 1500)
    })
  })
})()
</script>`}
          ></Script>
        </div>
      </div>
      <a href="https://play.teleporthq.io/signup" className="home-link5">
        <div aria-label="Sign up to TeleportHQ" className="home-container6">
          <svg
            width="24"
            height="24"
            viewBox="0 0 19 21"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="home-icon34"
          >
            <path
              d="M9.1017 4.64355H2.17867C0.711684 4.64355 -0.477539 5.79975 -0.477539 7.22599V13.9567C-0.477539 15.3829 0.711684 16.5391 2.17867 16.5391H9.1017C10.5687 16.5391 11.7579 15.3829 11.7579 13.9567V7.22599C11.7579 5.79975 10.5687 4.64355 9.1017 4.64355Z"
              fill="#B23ADE"
            ></path>
            <path
              d="M10.9733 12.7878C14.4208 12.7878 17.2156 10.0706 17.2156 6.71886C17.2156 3.3671 14.4208 0.649963 10.9733 0.649963C7.52573 0.649963 4.73096 3.3671 4.73096 6.71886C4.73096 10.0706 7.52573 12.7878 10.9733 12.7878Z"
              fill="#FF5C5C"
            ></path>
            <path
              d="M17.7373 13.3654C19.1497 14.1588 19.1497 15.4634 17.7373 16.2493L10.0865 20.5387C8.67402 21.332 7.51855 20.6836 7.51855 19.0968V10.5141C7.51855 8.92916 8.67402 8.2807 10.0865 9.07221L17.7373 13.3654Z"
              fill="#2874DE"
            ></path>
          </svg>
          <span className="home-text9">Built in TeleportHQ</span>
        </div>
      </a>
    </div>
  )
}

export default Home
