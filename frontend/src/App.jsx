import { useState, useEffect } from "react";
import axios from "axios";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./App.css";
import { Link } from "react-router-dom";
import emailjs from 'emailjs-com';

// Configure axios defaults

axios.defaults.timeout = 15000;

const serviceId=process.env.REACT_APP_EMAILJS_SERVICE_ID;
const templateId=process.env.REACT_APP_EMAILJS_TEMPLATE_ID;
const userId=process.env.REACT_APP_EMAILJS_USER_ID;

function App() {
  const [step, setStep] = useState(1);
  const [isSubmitError, setIsSubmitError] = useState(true);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    partySize: "",
    reservationTime: "",
    otp: "",
    specialRequests: "",
  });
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [errors, setErrors] = useState({});
  const [otpSent, setOtpSent] = useState(false);
  const [verified, setVerified] = useState(false);

  // Countdown timer for OTP resend
  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  const validateForm = (stepNumber) => {
    const newErrors = {};

    switch (stepNumber) {
      case 1:
        if (!formData.phone) {
          newErrors.phone = "Phone number is required";
        } else if (!/^\+[1-9]\d{1,14}$/.test(formData.phone)) {
          newErrors.phone =
            "Please enter a valid phone number with country code (e.g., +1234567890)";
        }
        break;
      case 2:
        if (!formData.otp) {
          newErrors.otp = "OTP is required";
        } else if (!/^\d{6}$/.test(formData.otp)) {
          newErrors.otp = "OTP must be 6 digits";
        }
        break;
      case 3:
        if (!formData.name || formData.name.trim().length < 2) {
          newErrors.name = "Name must be at least 2 characters";
        }
        if (
          !formData.partySize ||
          formData.partySize < 1 ||
          formData.partySize > 20
        ) {
          newErrors.partySize = "Party size must be between 1 and 20";
        }
        if (!formData.reservationTime) {
          newErrors.reservationTime = "Reservation time is required";
        } else {
          const selectedDate = new Date(formData.reservationTime);
          const now = new Date();
          const dayOfWeek = selectedDate.getDay();
          const hour = selectedDate.getHours();

          if (selectedDate <= now) {
            newErrors.reservationTime =
              "Reservation time must be in the future";
          } else if (dayOfWeek === 1) {
            newErrors.reservationTime = "We are closed on Mondays";
          } else if (hour < 11 || hour > 22) {
            newErrors.reservationTime =
              "Reservations are only available between 11 AM and 10 PM";
          }
        }
        break;
      default:
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    // Clear error when user starts typing
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: "",
      }));
    }
  };

  const formatPhoneNumber = (phone) => {
    const cleaned = phone.replace(/[\s\-()]/g, "");
    return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
  };

  const handlePhoneSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm(1)) return;

    setLoading(true);

    try {
      const formattedPhone = formatPhoneNumber(formData.phone);
      setFormData((prev) => ({ ...prev, phone: formattedPhone }));

      await axios.post("/api/send-otp", { phone: formattedPhone });

      setOtpSent(true);
      setCountdown(60); // 60 second cooldown
      toast.success("OTP sent to your WhatsApp!");
      setStep(2);
      setIsSubmitError(false);
    } catch (error) {
      const errorMessage =
        error.response?.data?.error || "Failed to send OTP. Please try again.";
      toast.error(errorMessage);

      if (error.response?.status === 429) {
        setCountdown(60);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOTPVerification = async (e) => {
    e.preventDefault();

    if (!validateForm(2)) return;

    setLoading(true);

    try {
      const { data } = await axios.post("/api/verify-otp", {
        phone: formData.phone,
        otp: formData.otp,
      });

      if (data.verified) {
        setVerified(true);
        setStep(3);
        toast.success("Phone number verified successfully!");
      }
    } catch (error) {
      const errorMessage =
        error.response?.data?.error ||
        "OTP verification failed. Please try again.";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleReservationSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm(3)) return;

    setLoading(true);

    try {
      const reservationData = {
        name: formData.name.trim(),
        phone: formData.phone,
        partySize: parseInt(formData.partySize),
        reservationTime: formData.reservationTime,
        specialRequests: formData.specialRequests.trim(),
      };

      await axios.post("/api/reservations", reservationData);

      

      emailjs.send(serviceId, templateId, {
    name: reservationData.name,
    phone_number: reservationData.phone,
    party_size: reservationData.partySize,
    reservation_time: reservationData.reservationTime,
    special_requests: reservationData.specialRequests || "None 🥲",
  },
  userId)
      .then((res) => {
       toast.success("Reservation created successfully!");
      }, (err) => {
        toast.error('Something went wrong.');

      });

      
      setStep(4);
    } catch (error) {
      const errorMessage =
        error.response?.data?.error ||
     "Failed to create reservation. Please try again.";
      toast.error(errorMessage);
      console.log(error)
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setFormData({
      name: "",
      phone: "",
      partySize: "",
      reservationTime: "",
      otp: "",
      specialRequests: "",
    });
    setVerified(false);
    setErrors({});
  };

  const getMinDateTime = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30); // Minimum 30 minutes from now
    return now.toISOString().slice(0, 16);
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <form onSubmit={handlePhoneSubmit} className="form-container">
            <h2>Enter Your Phone Number</h2>
            <p className="form-description">
              We'll send you a verification code via WhatsApp
            </p>

            <div className="form-group">
              <input
                type="tel"
                name="phone"
                placeholder="Phone number (e.g., +1234567890)"
                value={formData.phone}
                onChange={handleInputChange}
                required
                className={`input-field ${errors.phone ? "error" : ""}`}
              />
              {errors.phone && (
                <span className="error-message">{errors.phone}</span>
              )}
            </div>
            <Link to={!isSubmitError ? "/verify-otp" : "/"} style={{width: 'max-content'}} onClick={handlePhoneSubmit}>
              <button
                type="submit"
                disabled={loading || countdown > 0}
                className="submit-button">
                {loading
                  ? "Sending OTP..."
                  : countdown > 0
                  ? `Wait ${countdown}s`
                  : "Send OTP"}
              </button>
            </Link>

            <div className="info-text">
              <p>📱 Make sure your WhatsApp is active on this number</p>
            </div>
          </form>
        );

      case 2:
        return (
          <form onSubmit={handleOTPVerification} className="form-container">
            <h2>Verify OTP</h2>
            <p className="form-description">
              Enter the 6-digit code sent to {formData.phone}
            </p>

            <div className="form-group">
              <input
                type="text"
                name="otp"
                placeholder="Enter 6-digit OTP"
                value={formData.otp}
                onChange={handleInputChange}
                maxLength="6"
                pattern="\d{6}"
                required
                className={`input-field otp-input ${errors.otp ? "error" : ""}`}
              />
              {errors.otp && (
                <span className="error-message">{errors.otp}</span>
              )}
            </div>

            <Link to={!isSubmitError ? "/reservations" : "/"} style={{width: 'max-content'}} onClick={handleOTPVerification}>
            <button type="submit" disabled={loading} className="submit-button">
              {loading ? "Verifying..." : "Verify OTP"}
            </button>
          </Link>



            <div className="form-actions">
              <button
                type="button"
                onClick={handlePhoneSubmit}
                disabled={countdown > 0 || loading}
                className="link-button">
                {countdown > 0 ? `Resend in ${countdown}s` : "Resend OTP"}
              </button>

              <button
                type="button"
                onClick={() => setStep(1)}
                className="link-button">
                Change Phone Number
              </button>
            </div>
          </form>
        );

      case 3:
        return (
          <form onSubmit={handleReservationSubmit} className="form-container">
            <h2>Complete Your Reservation</h2>
            <p className="form-description">
              Please fill in your reservation details
            </p>

            <div className="form-group">
              <input
                type="text"
                name="name"
                placeholder="Full Name"
                value={formData.name}
                onChange={handleInputChange}
                required
                className={`input-field ${errors.name ? "error" : ""}`}
              />
              {errors.name && (
                <span className="error-message">{errors.name}</span>
              )}
            </div>

            <div className="form-group">
              <input
                type="number"
                name="partySize"
                placeholder="Party Size (1-20)"
                value={formData.partySize}
                onChange={handleInputChange}
                required
                min="1"
                max="20"
                className={`input-field ${errors.partySize ? "error" : ""}`}
              />
              {errors.partySize && (
                <span className="error-message">{errors.partySize}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="reservationTime" className="form-label">
                Reservation Date & Time
              </label>
              <input
                type="datetime-local"
                name="reservationTime"
                id="reservationTime"
                value={formData.reservationTime}
                onChange={handleInputChange}
                required
                min={getMinDateTime()}
                className={`input-field ${
                  errors.reservationTime ? "error" : ""
                }`}
              />
              {errors.reservationTime && (
                <span className="error-message">{errors.reservationTime}</span>
              )}
            </div>

            <div className="form-group">
              <textarea
                name="specialRequests"
                placeholder="Special requests or dietary requirements (optional)"
                value={formData.specialRequests}
                onChange={handleInputChange}
                maxLength="500"
                rows="3"
                className="input-field textarea"
              />
              <span className="char-count">
                {formData.specialRequests.length}/500
              </span>
            </div>

            <button type="submit" disabled={loading} className="submit-button">
              {loading ? "Creating Reservation..." : "Complete Reservation"}
            </button>

            <div className="info-text">
              <p>🕐 Hours: Tuesday-Sunday, 11 AM - 10 PM</p>
              <p>❌ Closed on Mondays</p>
            </div>
          </form>
        );

      case 4:
        return (
          <div className="success-container">
            <div className="success-icon">🎉</div>
            <h2>Reservation Confirmed!</h2>
            <div className="reservation-details">
              <p>
                <strong>Name:</strong> {formData.name}
              </p>
              <p>
                <strong>Party Size:</strong> {formData.partySize} people
              </p>
              <p>
                <strong>Date & Time:</strong>{" "}
                {new Date(formData.reservationTime).toLocaleString()}
              </p>
              <p>
                <strong>Phone:</strong> {formData.phone}
              </p>
              {formData.specialRequests && (
                <p>
                  <strong>Special Requests:</strong> {formData.specialRequests}
                </p>
              )}
            </div>
            <div className="success-message">
              <p>✅ Confirmation sent to your WhatsApp</p>
              <p>We look forward to serving you!</p>
            </div>
            <button onClick={resetForm} className="new-reservation-button">
              Make Another Reservation
            </button>
          </div>
        );

      default:
        return null;
    }
  };
   


  return (
    <div className="app-container">
      <header className="app-header">
        <h1>🍽️ Restaurant Reservation</h1>
        <div className="steps-indicator">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`step ${s === step ? "active" : ""} ${
                s < step ? "completed" : ""
              }`}>
              <span className="step-number">{s}</span>
              <span className="step-label">
                {s === 1 ? "Phone" : s === 2 ? "Verify" : "Reserve"}
              </span>
            </div>
          ))}
        </div>
      </header>

      <main className="main-content">{renderStep()}</main>

      <footer className="app-footer">
        <p>Need help? Contact us at support@restaurant.com</p>
      </footer>

      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
    </div>
  );
}

export default App;
